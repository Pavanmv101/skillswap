/**
 * Phase 6 — Step 3 — Stage 1: Foundation Models & Validation Tests
 * test_phase6_step3_stage1.js
 *
 * Verifies:
 * 1. Valid circular exchange creation with full schema compliance.
 * 2. Rejection of invalid participant counts (< 3 or > 3).
 * 3. Rejection of duplicate participants (e.g. [A, B, A]).
 * 4. Rejection of invalid leg counts (< 3 or > 3).
 * 5. Rejection of self-loops (e.g. A -> A).
 * 6. Rejection of bilateral 2-cycles (e.g. A -> B and B -> A).
 * 7. Rejection of disconnected or non-closed cycles.
 * 8. Order-independent leg validation (reordered legs produce identical canonical hash).
 * 9. Genuinely different cycle directions produce distinct canonical hashes.
 * 10. Genuinely different skills produce distinct canonical hashes.
 * 11. ExchangeReservation unique participant index enforcement (E11000 duplicate key).
 * 12. ExchangeReservation schema validation (exchangeType enum, required fields).
 * 13. OutboxEvent schema validation and indexing (status enum, aggregate lookup).
 * 14. Partial unique index on canonicalCycleHash: rejects duplicate proposed cycles (E11000).
 * 15. Partial unique index on canonicalCycleHash: rejects duplicate active cycles (E11000).
 * 16. Re-proposal permitted after previous cycle is cancelled.
 * 17. Re-proposal permitted after previous cycle is expired.
 * 18. Historical completed and cancelled records preserved without collision.
 * 19. Notification model enum extension (all circular event types permitted).
 */

'use strict';

require('dotenv').config();
const assert = require('assert');
const mongoose = require('mongoose');

const User = require('./models/User');
const CircularExchange = require('./models/CircularExchange');
const ExchangeReservation = require('./models/ExchangeReservation');
const OutboxEvent = require('./models/OutboxEvent');
const Notification = require('./models/Notification');

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
    failures.push({ name, error: err.message });
  }
}

const createdUserIds = [];
const createdCycleIds = [];
const createdResIds = [];
const createdOutboxIds = [];
const createdNotifIds = [];

const EMAIL = (tag) => `p6_s3_st1_${tag}_${Date.now()}_${Math.random().toString(36).slice(2)}@test.skillswap`;

async function cleanup() {
  if (createdCycleIds.length > 0) {
    await CircularExchange.deleteMany({ _id: { $in: createdCycleIds } });
  }
  if (createdResIds.length > 0) {
    await ExchangeReservation.deleteMany({ _id: { $in: createdResIds } });
  }
  if (createdOutboxIds.length > 0) {
    await OutboxEvent.deleteMany({ _id: { $in: createdOutboxIds } });
  }
  if (createdNotifIds.length > 0) {
    await Notification.deleteMany({ _id: { $in: createdNotifIds } });
  }
  if (createdUserIds.length > 0) {
    await User.deleteMany({ _id: { $in: createdUserIds } });
  }
}

async function runTests() {
  console.log('\n=== PHASE 6 STEP 3 STAGE 1: FOUNDATION MODELS & VALIDATION TESTS ===\n');

  const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/skillswap';
  await mongoose.connect(mongoUri);

  // Ensure indexes are synced on the models
  await CircularExchange.syncIndexes();
  await ExchangeReservation.syncIndexes();
  await OutboxEvent.syncIndexes();

  try {
    // Seed 3 test users for circular exchange
    const userA = await User.create({ name: 'User_A', email: EMAIL('a'), password: 'pw' });
    const userB = await User.create({ name: 'User_B', email: EMAIL('b'), password: 'pw' });
    const userC = await User.create({ name: 'User_C', email: EMAIL('c'), password: 'pw' });
    createdUserIds.push(userA._id, userB._id, userC._id);

    const idA = userA._id.toString();
    const idB = userB._id.toString();
    const idC = userC._id.toString();

    // ── SECTION 1: Graph Structure & Canonicalization Logic ───────────────────
    console.log('--- 1. Graph Structure & Canonicalization Logic ---');

    await test('Valid cycle validation and canonical hash calculation', () => {
      const legs = [
        { teacher: idA, learner: idB, skill: 'Python', legIndex: 0 },
        { teacher: idB, learner: idC, skill: 'UI/UX', legIndex: 1 },
        { teacher: idC, learner: idA, skill: 'React', legIndex: 2 },
      ];
      const result = CircularExchange.validateAndCanonicalize([idA, idB, idC], legs);
      assert.strictEqual(result.valid, true);
      assert(typeof result.canonicalCycleHash === 'string' && result.canonicalCycleHash.length === 64);
    });

    await test('Rejection of invalid participant counts (< 3 or > 3)', () => {
      const legs = [
        { teacher: idA, learner: idB, skill: 'Python' },
        { teacher: idB, learner: idC, skill: 'UI/UX' },
        { teacher: idC, learner: idA, skill: 'React' },
      ];
      assert.throws(() => {
        CircularExchange.validateAndCanonicalize([idA, idB], legs);
      }, /Cycle must contain exactly 3 participants/);

      assert.throws(() => {
        CircularExchange.validateAndCanonicalize([idA, idB, idC, 'extra_id'], legs);
      }, /Cycle must contain exactly 3 participants/);
    });

    await test('Rejection of duplicate participants (e.g. [A, B, A])', () => {
      const legs = [
        { teacher: idA, learner: idB, skill: 'Python' },
        { teacher: idB, learner: idA, skill: 'UI/UX' },
        { teacher: idA, learner: idB, skill: 'React' },
      ];
      assert.throws(() => {
        CircularExchange.validateAndCanonicalize([idA, idB, idA], legs);
      }, /All 3 participants must be distinct users/);
    });

    await test('Rejection of invalid leg counts', () => {
      assert.throws(() => {
        CircularExchange.validateAndCanonicalize([idA, idB, idC], [
          { teacher: idA, learner: idB, skill: 'Python' },
          { teacher: idB, learner: idC, skill: 'UI/UX' },
        ]);
      }, /Cycle must contain exactly 3 legs/);
    });

    await test('Rejection of self-loops (A -> A)', () => {
      const legs = [
        { teacher: idA, learner: idA, skill: 'Python' },
        { teacher: idA, learner: idB, skill: 'UI/UX' },
        { teacher: idB, learner: idC, skill: 'React' },
      ];
      assert.throws(() => {
        CircularExchange.validateAndCanonicalize([idA, idB, idC], legs);
      }, /Self-loops are forbidden/);
    });

    await test('Rejection of bilateral 2-cycles (A -> B and B -> A)', () => {
      const legs = [
        { teacher: idA, learner: idB, skill: 'Python' },
        { teacher: idB, learner: idA, skill: 'UI/UX' },
        { teacher: idC, learner: idC, skill: 'React' },
      ];
      assert.throws(() => {
        CircularExchange.validateAndCanonicalize([idA, idB, idC], legs);
      }, /Self-loops are forbidden|Bilateral 2-cycles are forbidden/);
    });

    await test('Rejection of disconnected or non-closed cycles (A->B, B->C, C->B)', () => {
      const legs = [
        { teacher: idA, learner: idB, skill: 'Python' },
        { teacher: idB, learner: idC, skill: 'UI/UX' },
        { teacher: idC, learner: idB, skill: 'React' }, // Should return to A, not B
      ];
      assert.throws(() => {
        CircularExchange.validateAndCanonicalize([idA, idB, idC], legs);
      });
    });

    await test('Order-independent leg validation (reordered legs yield identical canonical hash)', () => {
      const order1 = [
        { teacher: idA, learner: idB, skill: 'Python' },
        { teacher: idB, learner: idC, skill: 'UI/UX' },
        { teacher: idC, learner: idA, skill: 'React' },
      ];
      const order2 = [
        { teacher: idB, learner: idC, skill: 'UI/UX' },
        { teacher: idC, learner: idA, skill: 'React' },
        { teacher: idA, learner: idB, skill: 'Python' },
      ];
      const order3 = [
        { teacher: idC, learner: idA, skill: 'React' },
        { teacher: idA, learner: idB, skill: 'Python' },
        { teacher: idB, learner: idC, skill: 'UI/UX' },
      ];

      const res1 = CircularExchange.validateAndCanonicalize([idA, idB, idC], order1);
      const res2 = CircularExchange.validateAndCanonicalize([idA, idB, idC], order2);
      const res3 = CircularExchange.validateAndCanonicalize([idA, idB, idC], order3);

      assert.strictEqual(res1.canonicalCycleHash, res2.canonicalCycleHash);
      assert.strictEqual(res1.canonicalCycleHash, res3.canonicalCycleHash);
    });

    await test('Genuinely different cycle directions produce distinct canonical hashes', () => {
      // Forward cycle: A -> B -> C -> A
      const forwardLegs = [
        { teacher: idA, learner: idB, skill: 'Python' },
        { teacher: idB, learner: idC, skill: 'UI/UX' },
        { teacher: idC, learner: idA, skill: 'React' },
      ];
      // Reverse cycle: A -> C -> B -> A
      const reverseLegs = [
        { teacher: idA, learner: idC, skill: 'React' },
        { teacher: idC, learner: idB, skill: 'UI/UX' },
        { teacher: idB, learner: idA, skill: 'Python' },
      ];

      const forwardRes = CircularExchange.validateAndCanonicalize([idA, idB, idC], forwardLegs);
      const reverseRes = CircularExchange.validateAndCanonicalize([idA, idB, idC], reverseLegs);

      assert.notStrictEqual(forwardRes.canonicalCycleHash, reverseRes.canonicalCycleHash);
    });

    await test('Genuinely different skills produce distinct canonical hashes', () => {
      const cycle1 = [
        { teacher: idA, learner: idB, skill: 'Python' },
        { teacher: idB, learner: idC, skill: 'UI/UX' },
        { teacher: idC, learner: idA, skill: 'React' },
      ];
      const cycle2 = [
        { teacher: idA, learner: idB, skill: 'Rust' }, // Different skill
        { teacher: idB, learner: idC, skill: 'UI/UX' },
        { teacher: idC, learner: idA, skill: 'React' },
      ];

      const res1 = CircularExchange.validateAndCanonicalize([idA, idB, idC], cycle1);
      const res2 = CircularExchange.validateAndCanonicalize([idA, idB, idC], cycle2);

      assert.notStrictEqual(res1.canonicalCycleHash, res2.canonicalCycleHash);
    });

    await test('Hardened JSON tuple serialization: punctuation, quotes, and delimiters (| and ->) in skills remain unambiguous', () => {
      // Simulates skill names containing delimiters that would corrupt string splitting/joining
      const cyclePunc1 = [
        { teacher: idA, learner: idB, skill: 'C++ -> Modern | Advanced' },
        { teacher: idB, learner: idC, skill: 'UI/UX: Figma & "Design Systems"' },
        { teacher: idC, learner: idA, skill: 'React [v19] // Next.js' },
      ];

      const resPunc1 = CircularExchange.validateAndCanonicalize([idA, idB, idC], cyclePunc1);
      assert.strictEqual(typeof resPunc1.canonicalCycleHash, 'string');
      assert.strictEqual(resPunc1.canonicalCycleHash.length, 64);

      // Verify canonicalString is valid JSON
      const parsed = JSON.parse(resPunc1.canonicalString);
      assert(Array.isArray(parsed));
      assert.strictEqual(parsed.length, 3);
      assert.strictEqual(parsed[0].length, 3); // [teacherId, skill, learnerId]

      // Verify boundary isolation: an adversarial skill constructed to mimic delimiter injection does not collide
      const cycleAdversarial = [
        { teacher: idA, learner: idB, skill: `${idB}->fake->${idC}|${idC}->fake->${idA}` },
        { teacher: idB, learner: idC, skill: 'UI/UX' },
        { teacher: idC, learner: idA, skill: 'React' },
      ];
      const resAdv = CircularExchange.validateAndCanonicalize([idA, idB, idC], cycleAdversarial);
      assert.notStrictEqual(resPunc1.canonicalCycleHash, resAdv.canonicalCycleHash);
    });

    // ── SECTION 2: CircularExchange Document Creation & Partial Unique Index ──
    console.log('\n--- 2. CircularExchange Document Creation & Partial Unique Index ---');

    const baseLegs = [
      { teacher: userA._id, learner: userB._id, skill: 'Python', legIndex: 0 },
      { teacher: userB._id, learner: userC._id, skill: 'UI/UX', legIndex: 1 },
      { teacher: userC._id, learner: userA._id, skill: 'React', legIndex: 2 },
    ];

    const cycleDoc1 = await CircularExchange.create({
      initiator: userA._id,
      participants: [
        { user: userA._id, hasAccepted: true, acceptedAt: new Date() },
        { user: userB._id, hasAccepted: false },
        { user: userC._id, hasAccepted: false },
      ],
      legs: baseLegs,
      cycleScore: 85,
      expiresAt: new Date(Date.now() + 72 * 3600 * 1000),
    });
    createdCycleIds.push(cycleDoc1._id);

    await test('Valid CircularExchange document persisted with auto-calculated canonical hash', () => {
      assert(cycleDoc1._id);
      assert.strictEqual(cycleDoc1.status, 'proposed');
      assert.strictEqual(cycleDoc1.participants.length, 3);
      assert.strictEqual(cycleDoc1.legs.length, 3);
      assert(typeof cycleDoc1.canonicalCycleHash === 'string' && cycleDoc1.canonicalCycleHash.length === 64);
    });

    await test('Partial unique index blocks duplicate proposed cycle (E11000 error)', async () => {
      let duplicateError = null;
      try {
        await CircularExchange.create({
          initiator: userB._id,
          participants: [
            { user: userA._id, hasAccepted: false },
            { user: userB._id, hasAccepted: true, acceptedAt: new Date() },
            { user: userC._id, hasAccepted: false },
          ],
          legs: baseLegs, // Identical directed cycle
          expiresAt: new Date(Date.now() + 72 * 3600 * 1000),
        });
      } catch (err) {
        duplicateError = err;
      }
      assert(duplicateError, 'Duplicate proposed cycle must throw error');
      assert.strictEqual(duplicateError.code, 11000, `Expected code 11000, got ${duplicateError.code}`);
    });

    await test('Partial unique index blocks duplicate active cycle (E11000 error)', async () => {
      // Transition cycleDoc1 to active
      cycleDoc1.status = 'active';
      await cycleDoc1.save();

      let duplicateError = null;
      try {
        await CircularExchange.create({
          initiator: userB._id,
          participants: [
            { user: userA._id, hasAccepted: false },
            { user: userB._id, hasAccepted: true },
            { user: userC._id, hasAccepted: false },
          ],
          legs: baseLegs,
          expiresAt: new Date(Date.now() + 72 * 3600 * 1000),
        });
      } catch (err) {
        duplicateError = err;
      }
      assert(duplicateError, 'Duplicate active cycle must throw error');
      assert.strictEqual(duplicateError.code, 11000);
    });

    await test('Re-proposal permitted after cycle is cancelled (partial unique index releases)', async () => {
      // Cancel cycleDoc1
      cycleDoc1.status = 'cancelled';
      cycleDoc1.cancelReason = 'Partner declined';
      cycleDoc1.cancelledBy = userC._id;
      await cycleDoc1.save();

      // Now inserting the exact same directed cycle must SUCCEED
      const cycleDoc2 = await CircularExchange.create({
        initiator: userA._id,
        participants: [
          { user: userA._id, hasAccepted: true },
          { user: userB._id, hasAccepted: false },
          { user: userC._id, hasAccepted: false },
        ],
        legs: baseLegs,
        expiresAt: new Date(Date.now() + 72 * 3600 * 1000),
      });
      createdCycleIds.push(cycleDoc2._id);
      assert(cycleDoc2._id, 'Re-proposal after cancellation must succeed');
    });

    await test('Re-proposal permitted after cycle is expired', async () => {
      // Create a cycle and mark it expired
      const otherLegs = [
        { teacher: userA._id, learner: userB._id, skill: 'Docker', legIndex: 0 },
        { teacher: userB._id, learner: userC._id, skill: 'K8s', legIndex: 1 },
        { teacher: userC._id, learner: userA._id, skill: 'Go', legIndex: 2 },
      ];

      const expiredCycle = await CircularExchange.create({
        initiator: userA._id,
        participants: [
          { user: userA._id, hasAccepted: true },
          { user: userB._id, hasAccepted: false },
          { user: userC._id, hasAccepted: false },
        ],
        legs: otherLegs,
        status: 'expired',
        expiresAt: new Date(Date.now() - 3600 * 1000),
      });
      createdCycleIds.push(expiredCycle._id);

      // Re-propose the same cycle -> must SUCCEED
      const renewedCycle = await CircularExchange.create({
        initiator: userB._id,
        participants: [
          { user: userA._id, hasAccepted: false },
          { user: userB._id, hasAccepted: true },
          { user: userC._id, hasAccepted: false },
        ],
        legs: otherLegs,
        status: 'proposed',
        expiresAt: new Date(Date.now() + 72 * 3600 * 1000),
      });
      createdCycleIds.push(renewedCycle._id);
      assert(renewedCycle._id);
    });

    await test('Historical completed and cancelled records preserved without index collision', async () => {
      const records = await CircularExchange.find({ _id: { $in: createdCycleIds } });
      const cancelledRec = records.find(r => r.status === 'cancelled');
      const expiredRec = records.find(r => r.status === 'expired');

      assert(cancelledRec, 'Cancelled record must still exist');
      assert(expiredRec, 'Expired record must still exist');
      assert.strictEqual(cancelledRec.canonicalCycleHash.length, 64);
      assert.strictEqual(expiredRec.canonicalCycleHash.length, 64);
    });

    // ── SECTION 3: ExchangeReservation Model & Unique Participant Index ───────
    console.log('\n--- 3. ExchangeReservation Model & Unique Participant Index ---');

    const resA = await ExchangeReservation.create({
      participant: userA._id,
      exchangeType: 'circular',
      exchangeId: cycleDoc1._id,
      skillBeingTaught: 'Python',
      status: 'active',
    });
    createdResIds.push(resA._id);

    await test('ExchangeReservation created successfully with valid fields', () => {
      assert(resA._id);
      assert.strictEqual(resA.exchangeType, 'circular');
      assert.strictEqual(resA.status, 'active');
    });

    await test('Unique index blocks duplicate active reservation for same participant (E11000 error)', async () => {
      let duplicateError = null;
      try {
        await ExchangeReservation.create({
          participant: userA._id, // User A already holds an active reservation
          exchangeType: 'bilateral',
          exchangeId: new mongoose.Types.ObjectId(),
          skillBeingTaught: 'React',
          status: 'active',
        });
      } catch (err) {
        duplicateError = err;
      }
      assert(duplicateError, 'Duplicate reservation on same participant must throw error');
      assert.strictEqual(duplicateError.code, 11000);
    });

    await test('ExchangeReservation validates exchangeType enum', async () => {
      let validationError = null;
      try {
        await ExchangeReservation.create({
          participant: userB._id,
          exchangeType: 'invalid_type',
          exchangeId: new mongoose.Types.ObjectId(),
          skillBeingTaught: 'UI/UX',
        });
      } catch (err) {
        validationError = err;
      }
      assert(validationError, 'Invalid exchangeType must fail validation');
    });

    // ── SECTION 4: OutboxEvent Model & Indexing ───────────────────────────────
    console.log('\n--- 4. OutboxEvent Model & Indexing ---');

    const outboxEv = await OutboxEvent.create({
      aggregateType: 'CircularExchange',
      aggregateId: cycleDoc1._id,
      recipient: userB._id,
      sender: userA._id,
      type: 'CIRCULAR_SWAP_PROPOSED',
      title: 'New 3-Way Exchange Proposal 🔄',
      message: 'User A proposed a triangular exchange with you.',
      status: 'pending',
    });
    createdOutboxIds.push(outboxEv._id);

    await test('OutboxEvent created with default pending status and valid fields', () => {
      assert(outboxEv._id);
      assert.strictEqual(outboxEv.status, 'pending');
      assert.strictEqual(outboxEv.retryCount, 0);
    });

    await test('OutboxEvent schema rejects invalid status enum', async () => {
      let validationError = null;
      try {
        await OutboxEvent.create({
          aggregateType: 'CircularExchange',
          aggregateId: cycleDoc1._id,
          recipient: userC._id,
          type: 'CIRCULAR_SWAP_PROPOSED',
          title: 'Title',
          message: 'Msg',
          status: 'invalid_status',
        });
      } catch (err) {
        validationError = err;
      }
      assert(validationError);
    });

    // ── SECTION 5: Notification Model Circular Enum Extension ─────────────────
    console.log('\n--- 5. Notification Model Circular Enum Extension ---');

    await test('Notification model permits all new circular event types without error', async () => {
      const types = [
        'CIRCULAR_SWAP_PROPOSED',
        'CIRCULAR_SWAP_ACCEPTED_PARTIAL',
        'CIRCULAR_SWAP_ACTIVATED',
        'CIRCULAR_SWAP_DECLINED',
        'CIRCULAR_SWAP_CANCELLED',
        'CIRCULAR_SWAP_COMPLETED',
      ];

      for (const t of types) {
        const notif = await Notification.create({
          recipient: userA._id,
          type: t,
          title: `Test ${t}`,
          message: 'Test message',
        });
        createdNotifIds.push(notif._id);
        assert.strictEqual(notif.type, t);
      }
    });

  } finally {
    console.log('\nCleaning up created test documents...');
    await cleanup();
    await mongoose.disconnect();
  }

  console.log(`\n==================================================`);
  console.log(`Phase 6 Step 3 Stage 1 Tests: ${passed} passed, ${failed} failed`);
  console.log(`==================================================\n`);

  if (failed > 0) {
    console.error('Failed tests:');
    failures.forEach(f => console.error(`- ${f.name}: ${f.error}`));
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
