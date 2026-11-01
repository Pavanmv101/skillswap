/**
 * Phase 6 — Step 3 — Substage 3.1: Reservation Foundation & Bilateral Integration Tests
 * test_phase6_step3_stage3_sub1.js
 *
 * Verifies:
 * 1. Successful bilateral acceptance acquires exactly two reservations.
 * 2. Second bilateral acceptance involving a reserved participant returns 409 Conflict.
 * 3. Circular reservation blocks bilateral acceptance (409 Conflict).
 * 4. Bilateral reservation blocks future circular cycle discovery/activation.
 * 5. Successful completion releases both reservations atomically.
 * 6. Cancellation releases both reservations atomically.
 * 7. Repeated release is safe and idempotent (returns count 0).
 * 8. Same-exchange acquisition retry is idempotent.
 * 9. Different-exchange acquisition returns conflict (ReservationConflictError / 409).
 * 10. Legacy backfill with one accepted swap reserves correctly.
 * 11. Legacy backfill with multiple accepted swaps flags conflicts without choosing a winner.
 * 12. Backfill can be rerun safely (idempotent, skips already reserved).
 * 13. Transaction rollback leaves no partial reservations.
 * 14. Concurrent bilateral acceptance allows at most one winner (mutual exclusion).
 * 15. Existing bilateral behavior and authorization remain 100% compatible.
 */

'use strict';

require('dotenv').config();
const assert = require('assert');
const mongoose = require('mongoose');

const User = require('./models/User');
const SwapRequest = require('./models/SwapRequest');
const ExchangeReservation = require('./models/ExchangeReservation');
const CircularExchange = require('./models/CircularExchange');

const {
  acquireReservations,
  releaseReservations,
  getActiveReservations,
  backfillLegacyReservations,
  ReservationConflictError,
  withTransaction,
  isTransactionSupported,
} = require('./services/reservationService');

const {
  acceptSwapRequest,
  completeSwapRequest,
  cancelSwapRequest,
} = require('./controllers/swapController');

const {
  findCircularCycles,
} = require('./services/cycleDetectionService');

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ❌ ${name}: ${err.message}`);
    failed++;
    failures.push({ name, error: err.message, stack: err.stack });
  }
}

// Track IDs for clean teardown
const createdUserIds = [];
const createdSwapIds = [];
const createdResIds = [];
const createdCycleIds = [];

async function createTestUser(data = {}) {
  const unique = Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
  const user = await User.create({
    name: data.name || `User_${unique}`,
    email: data.email || `user_${unique}@example.com`,
    password: data.password || '$2a$10$hashedpasswordforexamplepurposesonly123',
    bio: data.bio || `Bio of ${unique}`,
    skillsOffered: data.skillsOffered || [],
    skillsWanted: data.skillsWanted || [],
    availabilitySlots: data.availabilitySlots || [{ day: 'Monday', from: '10:00', to: '12:00' }],
    blockedUsers: data.blockedUsers || [],
    averageRating: data.averageRating ?? 0,
    totalRatings: data.totalRatings ?? 0,
    role: data.role || 'student',
  });
  createdUserIds.push(user._id);
  return user;
}

async function createTestSwap(fromUser, toUser, options = {}) {
  const unique = Math.random().toString(36).substring(2, 8);
  const swap = await SwapRequest.create({
    fromUser: fromUser._id || fromUser,
    toUser: toUser._id || toUser,
    offeredSkill: options.offeredSkill || `SkillOffered_${unique}`,
    wantedSkill: options.wantedSkill || `SkillWanted_${unique}`,
    status: options.status || 'pending',
    scheduledAt: options.scheduledAt || null,
  });
  createdSwapIds.push(swap._id);
  return swap;
}

function mockRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
  };
  return res;
}

async function runTests() {
  console.log('\n===============================================================');
  console.log(' Phase 6 — Step 3 — Substage 3.1: Reservation Foundation');
  console.log('===============================================================\n');

  const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/skillswap';
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(mongoUri);
  }

  try {
    // ──────────────────────────────────────────────────────────────────────────
    // 1. UNIT TESTS: RESERVATION SERVICE FOUNDATIONS
    // ──────────────────────────────────────────────────────────────────────────
    console.log('--- 1. Reservation Service Unit Tests ---');

    await test('acquireReservations: Requires an active MongoDB transaction session', async () => {
      await assert.rejects(
        async () => {
          await acquireReservations({ reservations: [{ participant: new mongoose.Types.ObjectId() }] });
        },
        /session is required/
      );
    });

    await test('acquireReservations & releaseReservations: Idempotent same-exchange retry', async () => {
      const uA = new mongoose.Types.ObjectId();
      const uB = new mongoose.Types.ObjectId();
      const swapId = new mongoose.Types.ObjectId();

      await withTransaction(async (session) => {
        const reservations = [
          { participant: uA, exchangeType: 'bilateral', exchangeId: swapId, skillBeingTaught: 'Python' },
          { participant: uB, exchangeType: 'bilateral', exchangeId: swapId, skillBeingTaught: 'React' },
        ];

        // 1st acquisition
        const res1 = await acquireReservations({ reservations, session });
        assert.strictEqual(res1.count, 2);

        // 2nd acquisition for SAME exchange (idempotent retry)
        const res2 = await acquireReservations({ reservations, session });
        assert.strictEqual(res2.count, 2);
      });

      // Check active reservations in DB
      const active = await getActiveReservations([uA, uB]);
      assert.strictEqual(active.length, 2);
      createdResIds.push(...active.map(r => r._id));

      // Release reservations
      const release1 = await releaseReservations({ exchangeId: swapId });
      assert.strictEqual(release1.releasedCount, 2);

      // Repeated release is safe and returns count 0
      const release2 = await releaseReservations({ exchangeId: swapId });
      assert.strictEqual(release2.releasedCount, 0);

      const activeAfter = await getActiveReservations([uA, uB]);
      assert.strictEqual(activeAfter.length, 0);
    });

    await test('acquireReservations: Different-exchange acquisition throws 409 conflict', async () => {
      const uA = new mongoose.Types.ObjectId();
      const swapId1 = new mongoose.Types.ObjectId();
      const swapId2 = new mongoose.Types.ObjectId();

      await withTransaction(async (session1) => {
        await acquireReservations({
          reservations: [
            { participant: uA, exchangeType: 'bilateral', exchangeId: swapId1, skillBeingTaught: 'Python' },
          ],
          session: session1,
        });
      });

      // Clean up tracker
      const active = await getActiveReservations(uA);
      createdResIds.push(...active.map(r => r._id));

      // Attempt acquisition for uA by DIFFERENT exchange (swapId2)
      await withTransaction(async (session2) => {
        await assert.rejects(
          async () => {
            await acquireReservations({
              reservations: [
                { participant: uA, exchangeType: 'bilateral', exchangeId: swapId2, skillBeingTaught: 'Django' },
              ],
              session: session2,
            });
          },
          (err) => {
            assert(err instanceof ReservationConflictError);
            assert.strictEqual(err.code, 'RESERVATION_CONFLICT');
            assert.strictEqual(err.status, 409);
            return true;
          }
        );
      });

      await releaseReservations({ exchangeId: swapId1 });
    });

    await test('Transaction rollback leaves no partial reservations', async () => {
      const uA = new mongoose.Types.ObjectId();
      const uB = new mongoose.Types.ObjectId();
      const swapId = new mongoose.Types.ObjectId();

      if (isTransactionSupported()) {
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
          await acquireReservations({
            reservations: [
              { participant: uA, exchangeType: 'bilateral', exchangeId: swapId, skillBeingTaught: 'Python' },
              { participant: uB, exchangeType: 'bilateral', exchangeId: swapId, skillBeingTaught: 'React' },
            ],
            session,
          });

          // Deliberate rollback
          await session.abortTransaction();
        } finally {
          session.endSession();
        }
      } else {
        // In standalone mode, verify that a conflict/failure halfway rolls back/cleans up any partial reservations
        const uExisting = new mongoose.Types.ObjectId();
        const swapPrior = new mongoose.Types.ObjectId();
        await acquireReservations({
          reservations: [{ participant: uExisting, exchangeType: 'bilateral', exchangeId: swapPrior, skillBeingTaught: 'Java' }],
          session: null,
        });

        try {
          await assert.rejects(
            async () => {
              await acquireReservations({
                reservations: [
                  { participant: uA, exchangeType: 'bilateral', exchangeId: swapId, skillBeingTaught: 'Python' },
                  { participant: uExisting, exchangeType: 'bilateral', exchangeId: swapId, skillBeingTaught: 'React' },
                ],
                session: null,
              });
            },
            ReservationConflictError
          );
        } finally {
          await releaseReservations({ exchangeId: swapPrior });
        }
      }

      // Confirm no reservations exist in database after rollback
      const active = await getActiveReservations([uA, uB]);
      assert.strictEqual(active.length, 0, 'No reservations must persist after transaction rollback');
    });

    // ──────────────────────────────────────────────────────────────────────────
    // 2. BILATERAL ACCEPTANCE & RESERVATION INTEGRATION
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- 2. Bilateral Controller Acceptance Integration ---');

    await test('Successful bilateral acceptance acquires two reservations', async () => {
      const uA = await createTestUser({ name: 'Alice_Acc1' });
      const uB = await createTestUser({ name: 'Bob_Acc1' });
      const swap = await createTestSwap(uA, uB, { status: 'pending', offeredSkill: 'Node', wantedSkill: 'Python' });

      const req = {
        params: { id: swap._id.toString() },
        userId: uB._id.toString(), // Bob accepts
      };
      const res = mockRes();

      await acceptSwapRequest(req, res);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.status, 'accepted');

      const reservations = await getActiveReservations([uA._id, uB._id]);
      assert.strictEqual(reservations.length, 2);
      createdResIds.push(...reservations.map(r => r._id));

      const resA = reservations.find(r => r.participant.toString() === uA._id.toString());
      const resB = reservations.find(r => r.participant.toString() === uB._id.toString());
      assert(resA);
      assert(resB);
      assert.strictEqual(resA.exchangeType, 'bilateral');
      assert.strictEqual(resB.exchangeType, 'bilateral');
      assert.strictEqual(resA.exchangeId.toString(), swap._id.toString());
      assert.strictEqual(resB.exchangeId.toString(), swap._id.toString());
    });

    await test('Second bilateral acceptance involving a reserved participant returns 409 Conflict', async () => {
      const uA = await createTestUser({ name: 'Alice_Double' });
      const uB = await createTestUser({ name: 'Bob_Double' });
      const uC = await createTestUser({ name: 'Charlie_Double' });

      // Swap 1: uA <-> uB (accepted)
      const swap1 = await createTestSwap(uA, uB, { status: 'pending' });
      const req1 = { params: { id: swap1._id.toString() }, userId: uB._id.toString() };
      const res1 = mockRes();
      await acceptSwapRequest(req1, res1);
      assert.strictEqual(res1.statusCode, 200);

      const reservations1 = await getActiveReservations([uA._id, uB._id]);
      createdResIds.push(...reservations1.map(r => r._id));

      // Swap 2: uC <-> uB (attempt to accept while uB is already engaged in Swap 1)
      const swap2 = await createTestSwap(uC, uB, { status: 'pending' });
      const req2 = { params: { id: swap2._id.toString() }, userId: uB._id.toString() };
      const res2 = mockRes();
      await acceptSwapRequest(req2, res2);

      assert.strictEqual(res2.statusCode, 409);
      assert(res2.body.message.includes('active exchange'));

      // Verify Swap 2 remains pending and uC was NOT reserved
      const swap2Db = await SwapRequest.findById(swap2._id);
      assert.strictEqual(swap2Db.status, 'pending');

      const reservationsC = await getActiveReservations(uC._id);
      assert.strictEqual(reservationsC.length, 0);
    });

    await test('Circular reservation blocks bilateral acceptance (409 Conflict)', async () => {
      const uA = await createTestUser({ name: 'Alice_CircLock' });
      const uB = await createTestUser({ name: 'Bob_CircLock' });
      const fakeCycleId = new mongoose.Types.ObjectId();

      // Pre-create an active circular reservation for uB
      const circRes = await ExchangeReservation.create({
        participant: uB._id,
        exchangeType: 'circular',
        exchangeId: fakeCycleId,
        skillBeingTaught: 'GoLang',
        status: 'active',
      });
      createdResIds.push(circRes._id);

      // uA proposes to uB; uB tries to accept bilateral swap
      const swap = await createTestSwap(uA, uB, { status: 'pending' });
      const req = { params: { id: swap._id.toString() }, userId: uB._id.toString() };
      const res = mockRes();

      await acceptSwapRequest(req, res);

      assert.strictEqual(res.statusCode, 409);
      assert(res.body.message.includes('active exchange'));

      // Verify swap was not accepted
      const swapDb = await SwapRequest.findById(swap._id);
      assert.strictEqual(swapDb.status, 'pending');
    });

    await test('Bilateral reservation blocks future circular cycle discovery', async () => {
      const uTag = Date.now().toString(36) + '_circblock';
      const s1 = `Skill1_${uTag}`;
      const s2 = `Skill2_${uTag}`;
      const s3 = `Skill3_${uTag}`;

      const uA = await createTestUser({
        name: 'Alice_CircDisc',
        skillsOffered: [{ skill: s1, level: 'Advanced' }],
        skillsWanted: [{ skill: s3, level: 'Intermediate' }],
      });
      const uB = await createTestUser({
        name: 'Bob_CircDisc',
        skillsOffered: [{ skill: s2, level: 'Advanced' }],
        skillsWanted: [{ skill: s1, level: 'Intermediate' }],
      });
      const uC = await createTestUser({
        name: 'Charlie_CircDisc',
        skillsOffered: [{ skill: s3, level: 'Advanced' }],
        skillsWanted: [{ skill: s2, level: 'Intermediate' }],
      });
      const uPartner = await createTestUser({ name: 'UnrelatedPartner' });

      // Put uB in an active bilateral swap with reservations
      const swap = await createTestSwap(uB, uPartner, { status: 'pending', offeredSkill: s2, wantedSkill: 'Other' });
      const req = { params: { id: swap._id.toString() }, userId: uPartner._id.toString() };
      const resAccept = mockRes();
      await acceptSwapRequest(req, resAccept);
      assert.strictEqual(resAccept.statusCode, 200);

      const reservations = await getActiveReservations([uB._id, uPartner._id]);
      createdResIds.push(...reservations.map(r => r._id));

      // Attempt circular discovery for uA: uB is reserved, so cycle must be excluded
      const discoveryResult = await findCircularCycles(uA);
      assert.strictEqual(discoveryResult.cycles.length, 0, 'Circular cycle involving reserved user must be excluded');

      // Complete swap -> reservations released -> cycle becomes discoverable
      const reqComplete = { params: { id: swap._id.toString() }, userId: uB._id.toString() };
      const resComplete = mockRes();
      await completeSwapRequest(reqComplete, resComplete);
      assert.strictEqual(resComplete.statusCode, 200);

      const discoveryAfter = await findCircularCycles(uA);
      assert(discoveryAfter.cycles.length >= 1, 'Cycle should be discoverable once reservations are released');
    });

    // ──────────────────────────────────────────────────────────────────────────
    // 3. BILATERAL COMPLETION & CANCELLATION
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- 3. Bilateral Completion & Cancellation ---');

    await test('Successful completion releases both participant reservations', async () => {
      const uA = await createTestUser({ name: 'Alice_Comp' });
      const uB = await createTestUser({ name: 'Bob_Comp' });
      const swap = await createTestSwap(uA, uB, { status: 'pending' });

      // Accept
      const reqAcc = { params: { id: swap._id.toString() }, userId: uB._id.toString() };
      await acceptSwapRequest(reqAcc, mockRes());
      let active = await getActiveReservations([uA._id, uB._id]);
      assert.strictEqual(active.length, 2);

      // Complete
      const reqComp = { params: { id: swap._id.toString() }, userId: uA._id.toString() };
      const resComp = mockRes();
      await completeSwapRequest(reqComp, resComp);
      assert.strictEqual(resComp.statusCode, 200);
      assert.strictEqual(resComp.body.status, 'completed');

      // Verify reservations released
      active = await getActiveReservations([uA._id, uB._id]);
      assert.strictEqual(active.length, 0);
    });

    await test('Cancellation releases both participant reservations', async () => {
      const uA = await createTestUser({ name: 'Alice_Canc' });
      const uB = await createTestUser({ name: 'Bob_Canc' });
      const swap = await createTestSwap(uA, uB, { status: 'pending' });

      // Accept
      await acceptSwapRequest({ params: { id: swap._id.toString() }, userId: uB._id.toString() }, mockRes());
      let active = await getActiveReservations([uA._id, uB._id]);
      assert.strictEqual(active.length, 2);

      // Cancel by sender
      const reqCanc = { params: { id: swap._id.toString() }, userId: uA._id.toString(), body: { reason: 'Changed mind' } };
      const resCanc = mockRes();
      await cancelSwapRequest(reqCanc, resCanc);
      assert.strictEqual(resCanc.statusCode, 200);
      assert.strictEqual(resCanc.body.status, 'cancelled');

      // Verify reservations released
      active = await getActiveReservations([uA._id, uB._id]);
      assert.strictEqual(active.length, 0);
    });

    // ──────────────────────────────────────────────────────────────────────────
    // 4. CONCURRENCY & RACING SAFEGUARDS
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- 4. Concurrency & Racing Safeguards ---');

    await test('Concurrent acceptance race allows at most ONE winner', async () => {
      const uA = await createTestUser({ name: 'Alice_Race' });
      const uB = await createTestUser({ name: 'Bob_Race' });
      const uC = await createTestUser({ name: 'Charlie_Race' });

      // Bob receives two swaps: one from Alice, one from Charlie
      const swap1 = await createTestSwap(uA, uB, { status: 'pending' });
      const swap2 = await createTestSwap(uC, uB, { status: 'pending' });

      const req1 = { params: { id: swap1._id.toString() }, userId: uB._id.toString() };
      const res1 = mockRes();

      const req2 = { params: { id: swap2._id.toString() }, userId: uB._id.toString() };
      const res2 = mockRes();

      // Fire both acceptances concurrently
      await Promise.all([
        acceptSwapRequest(req1, res1),
        acceptSwapRequest(req2, res2),
      ]);

      const statusCodes = [res1.statusCode, res2.statusCode];
      assert(statusCodes.includes(200), 'Exactly one acceptance must succeed with 200');
      assert(statusCodes.includes(409), 'The competing acceptance must fail with 409 Conflict');

      // Confirm Bob holds exactly ONE active reservation in the database
      const bobReservations = await getActiveReservations(uB._id);
      assert.strictEqual(bobReservations.length, 1);
      createdResIds.push(...bobReservations.map(r => r._id));
    });

    // ──────────────────────────────────────────────────────────────────────────
    // 5. LEGACY BACKFILL & CONFLICT AUDIT
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- 5. Legacy Backfill & Conflict Audit ---');

    await test('Legacy backfill: Dry-run accurately reports planned actions without database writes', async () => {
      const u1 = await createTestUser({ name: 'User_Legacy1' });
      const u2 = await createTestUser({ name: 'User_Legacy2' });
      const s = await createTestSwap(u1, u2, { status: 'accepted', offeredSkill: 'Java', wantedSkill: 'Python' });

      const report = await backfillLegacyReservations({ dryRun: true, participantIds: [u1._id, u2._id] });
      assert.strictEqual(report.dryRun, true);
      assert.strictEqual(report.totalAcceptedSwaps, 1);
      assert.strictEqual(report.unambiguousCount, 2);
      assert.strictEqual(report.backfilledCount, 0, 'Dry-run must write 0 records');
    });

    await test('Legacy backfill: Single accepted swap reserves correctly and idempotently', async () => {
      const u1 = await createTestUser({ name: 'User_LegNorm1' });
      const u2 = await createTestUser({ name: 'User_LegNorm2' });
      const s = await createTestSwap(u1, u2, { status: 'accepted', offeredSkill: 'C++', wantedSkill: 'Rust' });

      // Run backfill
      const run1 = await backfillLegacyReservations({ dryRun: false, participantIds: [u1._id, u2._id] });
      assert.strictEqual(run1.dryRun, false);
      assert.strictEqual(run1.backfilledCount, 2);
      createdResIds.push(...(run1.createdReservationIds || []));

      const res1 = await getActiveReservations([u1._id, u2._id]);
      assert.strictEqual(res1.length, 2);

      const rU1 = res1.find(r => r.participant.toString() === u1._id.toString());
      assert.strictEqual(rU1.skillBeingTaught, 'C++');
      assert.strictEqual(rU1.exchangeType, 'bilateral');
      assert.strictEqual(rU1.exchangeId.toString(), s._id.toString());

      // Re-run backfill safely (idempotent, skips already reserved)
      const run2 = await backfillLegacyReservations({ dryRun: false, participantIds: [u1._id, u2._id] });
      assert.strictEqual(run2.backfilledCount, 0, 'Re-run must not create duplicate reservations');
      const res2 = await getActiveReservations([u1._id, u2._id]);
      assert.strictEqual(res2.length, 2, 'Re-run must preserve existing reservations');
    });

    await test('Legacy backfill: Multiple accepted swaps flags conflict without picking winner', async () => {
      const uConflicted = await createTestUser({ name: 'User_MultiAccepted' });
      const uPartner1 = await createTestUser({ name: 'Partner1' });
      const uPartner2 = await createTestUser({ name: 'Partner2' });

      // Create TWO active accepted swaps involving uConflicted
      const s1 = await createTestSwap(uConflicted, uPartner1, { status: 'accepted' });
      const s2 = await createTestSwap(uConflicted, uPartner2, { status: 'accepted' });

      const fakeLogs = [];
      const mockLogger = {
        warn(msg) { fakeLogs.push(msg); },
        log() {},
        error() {},
      };

      const result = await backfillLegacyReservations({
        dryRun: false,
        logger: mockLogger,
        participantIds: [uConflicted._id, uPartner1._id, uPartner2._id],
      });
      createdResIds.push(...(result.createdReservationIds || []));

      // Verify conflict detected and reported
      assert(result.conflictedCount >= 1);
      const conflictEntry = result.conflicts.find(c => c.participantId === uConflicted._id.toString());
      assert(conflictEntry, 'Conflicted participant must be logged');
      assert.strictEqual(conflictEntry.conflictingSwapIds.length, 2);
      assert(conflictEntry.conflictingSwapIds.includes(s1._id.toString()));
      assert(conflictEntry.conflictingSwapIds.includes(s2._id.toString()));

      // Verify NO reservation was created for uConflicted (never pick arbitrary winner)
      const conflictedReservations = await getActiveReservations(uConflicted._id);
      assert.strictEqual(
        conflictedReservations.length,
        0,
        'No reservation must be created for ambiguous / conflicted participant'
      );

      // Verify structured warning logged
      assert(fakeLogs.some(l => l.includes('LEGACY_RESERVATION_CONFLICT')));
    });

    // ──────────────────────────────────────────────────────────────────────────
    // 6. BACKWARD COMPATIBILITY & AUTHORIZATION
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- 6. Backward Compatibility & Authorization ---');

    await test('Existing authorization: Non-recipient cannot accept swap (403 Forbidden)', async () => {
      const uA = await createTestUser({ name: 'Alice_Auth' });
      const uB = await createTestUser({ name: 'Bob_Auth' });
      const uImposter = await createTestUser({ name: 'Imposter' });
      const swap = await createTestSwap(uA, uB, { status: 'pending' });

      const req = { params: { id: swap._id.toString() }, userId: uImposter._id.toString() };
      const res = mockRes();
      await acceptSwapRequest(req, res);

      assert.strictEqual(res.statusCode, 403);
      assert.strictEqual(res.body.message, 'Not authorized to accept this request');
    });

    await test('Existing validation: Non-pending request cannot be accepted (400 Bad Request)', async () => {
      const uA = await createTestUser({ name: 'Alice_BadReq' });
      const uB = await createTestUser({ name: 'Bob_BadReq' });
      const swap = await createTestSwap(uA, uB, { status: 'rejected' });

      const req = { params: { id: swap._id.toString() }, userId: uB._id.toString() };
      const res = mockRes();
      await acceptSwapRequest(req, res);

      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.body.message, 'Only pending requests can be accepted');
    });

  } finally {
    // ── Teardown ──────────────────────────────────────────────────────────────
    console.log('\n--- Cleaning up test records ---');
    if (createdResIds.length > 0) {
      await ExchangeReservation.deleteMany({ _id: { $in: createdResIds } });
    }
    if (createdSwapIds.length > 0) {
      await SwapRequest.deleteMany({ _id: { $in: createdSwapIds } });
    }
    if (createdUserIds.length > 0) {
      await User.deleteMany({ _id: { $in: createdUserIds } });
    }
    console.log(`Cleaned up ${createdUserIds.length} users, ${createdSwapIds.length} swaps, ${createdResIds.length} reservations.`);
  }

  console.log('\n===============================================================');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('===============================================================\n');

  if (failed > 0) {
    console.error('Failures:', failures);
    process.exit(1);
  }
}

runTests()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Fatal test error:', err);
    process.exit(1);
  });
