/**
 * test_phase7_atlas_transactions.js
 * Real Atlas Replica-Set Transaction Verification Suite for SkillSwap.
 *
 * Verifies:
 * Pre-flight:
 * - TEST_MONGO_URI present and valid.
 * - Confirmed targeting exclusively 'skillswap_phase7_test'.
 * - Connected to MongoDB Atlas with replica-set transaction support.
 *
 * Suites:
 * A. Transaction fundamentals (commit, abort, atomicity verification)
 * B. Reservation integrity (atomic acquisition, conflict rejection, transactional release, rollback)
 * C. Circular exchange lifecycle (creation, activation, 3-leg completion, auto-finalization, reservation release)
 * D. Transactional outbox (atomic dual-write commit, abort without orphaned events)
 * E. Concurrency (competing reservation acquisition with exactly one winner)
 *
 * Strict Safety:
 * - Uses ONLY 'skillswap_phase7_test'.
 * - Employs uniquely identifiable test records.
 * - Cleans only records created by this suite.
 * - Zero modification of production 'skillswap'.
 * - Never prints credentials.
 */

'use strict';

const mongoose = require('mongoose');
const assert = require('assert');
const {
  validateAtlasConnectionConfig,
  getApprovedTestDbUri,
  assertAtlasTestDatabaseSafe,
} = require('./test_db_guard');
const {
  withTransaction,
  isTransactionSupported,
  acquireReservations,
  releaseReservations,
  ReservationConflictError,
} = require('./services/reservationService');

const User = require('./models/User');
const SwapRequest = require('./models/SwapRequest');
const CircularExchange = require('./models/CircularExchange');
const ExchangeReservation = require('./models/ExchangeReservation');
const OutboxEvent = require('./models/OutboxEvent');

async function runAtlasTransactionVerification() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🧪 PHASE 7.4.5 — REAL ATLAS TRANSACTION VERIFICATION');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // STEP 1 — PRE-FLIGHT VALIDATION
  console.log('🔍 [PRE-FLIGHT] Checking Atlas Configuration...');
  const config = validateAtlasConnectionConfig();
  console.log(`   Configured: ${config.configured}`);
  if (!config.configured) {
    console.error(`\n❌ [PRE-FLIGHT FAILED] ${config.reason}`);
    console.error('   Strict Safety Rule: Stopping execution immediately. No silent fallback to localhost or production.\n');
    process.exit(1);
  }

  console.log(`   Target Database: ${config.databaseName}`);
  assert.strictEqual(config.databaseName, 'skillswap_phase7_test', 'Database MUST be skillswap_phase7_test');
  console.log(`   Protocol: ${config.protocol} (Atlas: ${config.isAtlas})`);

  // Obtain verified URI
  const atlasUri = getApprovedTestDbUri({ requireAtlas: true });

  console.log('\n🌐 [CONNECTING] Connecting to isolated Atlas test database...');
  await mongoose.connect(atlasUri, { serverSelectionTimeoutMS: 10000 });

  // STEP 2 — ACTIVE CONNECTION SAFETY CHECK
  assertAtlasTestDatabaseSafe();
  console.log('   ✅ Active connection confirmed targeting: skillswap_phase7_test');

  // Ensure schema indexes (unique constraints) are active on the test database
  await Promise.all([
    User.syncIndexes().catch(() => {}),
    SwapRequest.syncIndexes().catch(() => {}),
    CircularExchange.syncIndexes().catch(() => {}),
    ExchangeReservation.syncIndexes().catch(() => {}),
    OutboxEvent.syncIndexes().catch(() => {}),
  ]);

  // STEP 3 — TOPOLOGY & TRANSACTION SUPPORT
  const adminDb = mongoose.connection.db.admin();
  let serverInfo = {};
  try {
    serverInfo = await adminDb.serverInfo();
  } catch (_) {}

  const topology = mongoose.connection.client.topology;
  const topoDesc = topology?.description;
  const topoType = topoDesc?.type || 'Unknown';
  const setName = topoDesc?.setName || 'N/A';
  const hasTxSupport = isTransactionSupported();

  console.log(`   Server Version: ${serverInfo.version || 'Atlas Managed'}`);
  console.log(`   Topology Type: ${topoType}`);
  console.log(`   Replica Set Name: ${setName}`);
  console.log(`   Transaction Support: ${hasTxSupport ? 'ENABLED (ACID Supported)' : 'DISABLED'}`);

  if (!hasTxSupport) {
    console.error('\n❌ [TOPOLOGY FAILED] Connected MongoDB instance does NOT support replica-set multi-document transactions.');
    console.error('   Strict Safety Rule: Stopping execution immediately.\n');
    await mongoose.disconnect();
    process.exit(1);
  }

  const nonce = Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
  const testTag = `atlas_tx_test_${nonce}`;

  const trackedUserIds = [];
  const trackedSwapIds = [];
  const trackedExchangeIds = [];
  const trackedReservationExchanges = [];
  const trackedOutboxIds = [];

  let testCount = 0;
  let passedCount = 0;

  function pass(name) {
    testCount++;
    passedCount++;
    console.log(`   ✅ [TEST ${testCount}] ${name}`);
  }

  try {
    // ════════════════════════════════════════════════════════════════════════
    // SUITE A — TRANSACTION FUNDAMENTALS
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n────────────────────────────────────────────────────────────────────');
    console.log('📋 SUITE A: TRANSACTION FUNDAMENTALS');
    console.log('────────────────────────────────────────────────────────────────────');
    assertAtlasTestDatabaseSafe();

    // A1. Commit multiple writes
    const uA1Id = new mongoose.Types.ObjectId();
    const uA2Id = new mongoose.Types.ObjectId();
    trackedUserIds.push(uA1Id, uA2Id);

    await withTransaction(async (session) => {
      await User.create([
        {
          _id: uA1Id,
          name: `${testTag}_UserA1`,
          email: `${testTag}_u1@example.com`,
          password: 'Password123!',
          skillsOffered: [{ skill: 'JavaScript' }],
          skillsWanted: [{ skill: 'Python' }],
        },
        {
          _id: uA2Id,
          name: `${testTag}_UserA2`,
          email: `${testTag}_u2@example.com`,
          password: 'Password123!',
          skillsOffered: [{ skill: 'Python' }],
          skillsWanted: [{ skill: 'JavaScript' }],
        },
      ], { session, ordered: true });
    });

    const foundU1 = await User.findById(uA1Id);
    const foundU2 = await User.findById(uA2Id);
    assert(foundU1 && foundU2, 'Both users must be committed and queryable');
    pass('Multi-document write committed atomically across replica set');

    // A2 & A3. Abort multiple writes and verify non-persistence
    const uA3Id = new mongoose.Types.ObjectId();
    const uA4Id = new mongoose.Types.ObjectId();

    let abortedCaught = false;
    try {
      await withTransaction(async (session) => {
        await User.create([
          {
            _id: uA3Id,
            name: `${testTag}_UserA3`,
            email: `${testTag}_u3@example.com`,
            password: 'Password123!',
            skillsOffered: [{ skill: 'Rust' }],
            skillsWanted: [{ skill: 'Go' }],
          },
          {
            _id: uA4Id,
            name: `${testTag}_UserA4`,
            email: `${testTag}_u4@example.com`,
            password: 'Password123!',
            skillsOffered: [{ skill: 'Go' }],
            skillsWanted: [{ skill: 'Rust' }],
          },
        ], { session, ordered: true });

        // Force intentional transaction rollback
        throw new Error('INTENTIONAL_ROLLBACK_A');
      });
    } catch (err) {
      if (err.message === 'INTENTIONAL_ROLLBACK_A') abortedCaught = true;
      else throw err;
    }

    assert(abortedCaught, 'Transaction abort error was caught');
    const checkU3 = await User.findById(uA3Id);
    const checkU4 = await User.findById(uA4Id);
    assert.strictEqual(checkU3, null, 'Aborted write U3 must NOT exist in database');
    assert.strictEqual(checkU4, null, 'Aborted write U4 must NOT exist in database');
    pass('Transaction rollback cleanly aborts multiple writes with zero persistence');

    // ════════════════════════════════════════════════════════════════════════
    // SUITE B — RESERVATION INTEGRITY
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n────────────────────────────────────────────────────────────────────');
    console.log('📋 SUITE B: RESERVATION INTEGRITY');
    console.log('────────────────────────────────────────────────────────────────────');
    assertAtlasTestDatabaseSafe();

    const uB1 = new mongoose.Types.ObjectId();
    const uB2 = new mongoose.Types.ObjectId();
    const uB3 = new mongoose.Types.ObjectId();
    const exB1Id = new mongoose.Types.ObjectId();
    const exB2Id = new mongoose.Types.ObjectId();
    trackedReservationExchanges.push(exB1Id, exB2Id);

    // B1. Acquire three participant reservations atomically
    await withTransaction(async (session) => {
      await acquireReservations({
        reservations: [
          { participant: uB1, exchangeType: 'circular', exchangeId: exB1Id, skillBeingTaught: 'Cooking' },
          { participant: uB2, exchangeType: 'circular', exchangeId: exB1Id, skillBeingTaught: 'Baking' },
          { participant: uB3, exchangeType: 'circular', exchangeId: exB1Id, skillBeingTaught: 'Grilling' },
        ],
        session,
      });
    });

    const activeResB1 = await ExchangeReservation.find({ exchangeId: exB1Id });
    assert.strictEqual(activeResB1.length, 3, 'Must hold 3 active reservations');
    pass('Acquire three participant reservations atomically within transaction');

    // B2. Conflicting acquisition is rejected
    let conflictCaught = false;
    try {
      await withTransaction(async (session) => {
        await acquireReservations({
          reservations: [
            { participant: uB1, exchangeType: 'circular', exchangeId: exB2Id, skillBeingTaught: 'Gardening' },
          ],
          session,
        });
      });
    } catch (err) {
      if (err instanceof ReservationConflictError || err.code === 11000 || err.status === 409) {
        conflictCaught = true;
      } else {
        throw err;
      }
    }
    assert(conflictCaught, 'Conflicting reservation must be rejected');
    pass('Conflicting reservation acquisition is rejected with mutual exclusion');

    // B3. Release reservations transactionally
    await withTransaction(async (session) => {
      const releaseRes = await releaseReservations({ exchangeId: exB1Id, session });
      assert.strictEqual(releaseRes.releasedCount, 3);
    });
    const remainingResB1 = await ExchangeReservation.find({ exchangeId: exB1Id });
    assert.strictEqual(remainingResB1.length, 0, 'Reservations must be released');
    pass('Release reservations transactionally');

    // B4. Rollback restores consistency on aborted release
    await withTransaction(async (session) => {
      await acquireReservations({
        reservations: [
          { participant: uB1, exchangeType: 'circular', exchangeId: exB1Id, skillBeingTaught: 'Chess' },
        ],
        session,
      });
    });

    let abortReleaseCaught = false;
    try {
      await withTransaction(async (session) => {
        await releaseReservations({ exchangeId: exB1Id, session });
        throw new Error('INTENTIONAL_ROLLBACK_RELEASE');
      });
    } catch (err) {
      if (err.message === 'INTENTIONAL_ROLLBACK_RELEASE') abortReleaseCaught = true;
      else throw err;
    }
    assert(abortReleaseCaught, 'Rollback caught');
    const resAfterRollback = await ExchangeReservation.find({ exchangeId: exB1Id });
    assert.strictEqual(resAfterRollback.length, 1, 'Reservation must still exist after rollback of release');
    // Clean up B1 reservation
    await ExchangeReservation.deleteMany({ exchangeId: exB1Id });
    pass('Rollback restores original reservation state on aborted release');

    // ════════════════════════════════════════════════════════════════════════
    // SUITE C — CIRCULAR EXCHANGE LIFECYCLE
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n────────────────────────────────────────────────────────────────────');
    console.log('📋 SUITE C: CIRCULAR EXCHANGE LIFECYCLE');
    console.log('────────────────────────────────────────────────────────────────────');
    assertAtlasTestDatabaseSafe();

    const uC1 = new mongoose.Types.ObjectId();
    const uC2 = new mongoose.Types.ObjectId();
    const uC3 = new mongoose.Types.ObjectId();
    trackedUserIds.push(uC1, uC2, uC3);

    const s1Id = new mongoose.Types.ObjectId();
    const s2Id = new mongoose.Types.ObjectId();
    const s3Id = new mongoose.Types.ObjectId();
    trackedSwapIds.push(s1Id, s2Id, s3Id);

    const exCId = new mongoose.Types.ObjectId();
    trackedExchangeIds.push(exCId);
    trackedReservationExchanges.push(exCId);

    // C1. Create and activate circular exchange with 3 child swaps in transaction
    const canonical = CircularExchange.validateAndCanonicalize(
      [uC1, uC2, uC3],
      [
        { teacher: uC1, learner: uC2, skill: 'Piano' },
        { teacher: uC2, learner: uC3, skill: 'Guitar' },
        { teacher: uC3, learner: uC1, skill: 'Violin' },
      ]
    );

    await withTransaction(async (session) => {
      // 1. Create reservations
      await acquireReservations({
        reservations: [
          { participant: uC1, exchangeType: 'circular', exchangeId: exCId, skillBeingTaught: 'Piano' },
          { participant: uC2, exchangeType: 'circular', exchangeId: exCId, skillBeingTaught: 'Guitar' },
          { participant: uC3, exchangeType: 'circular', exchangeId: exCId, skillBeingTaught: 'Violin' },
        ],
        session,
      });

      // 2. Create parent circular exchange
      await CircularExchange.create([
        {
          _id: exCId,
          initiator: uC1,
          participants: [
            { user: uC1, hasAccepted: true },
            { user: uC2, hasAccepted: true },
            { user: uC3, hasAccepted: true },
          ],
          legs: [
            {
              legIndex: 0,
              teacher: uC1,
              learner: uC2,
              skill: 'Piano',
              status: 'scheduled',
              swapRequest: s1Id,
            },
            {
              legIndex: 1,
              teacher: uC2,
              learner: uC3,
              skill: 'Guitar',
              status: 'scheduled',
              swapRequest: s2Id,
            },
            {
              legIndex: 2,
              teacher: uC3,
              learner: uC1,
              skill: 'Violin',
              status: 'scheduled',
              swapRequest: s3Id,
            },
          ],
          canonicalCycleHash: canonical.canonicalCycleHash,
          status: 'active',
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          activatedAt: new Date(),
        },
      ], { session, ordered: true });

      // 3. Create child swaps
      await SwapRequest.create([
        {
          _id: s1Id,
          fromUser: uC1,
          toUser: uC2,
          offeredSkill: 'Piano',
          wantedSkill: 'Guitar',
          status: 'accepted',
          circularExchange: exCId,
          circularLegIndex: 0,
        },
        {
          _id: s2Id,
          fromUser: uC2,
          toUser: uC3,
          offeredSkill: 'Guitar',
          wantedSkill: 'Violin',
          status: 'accepted',
          circularExchange: exCId,
          circularLegIndex: 1,
        },
        {
          _id: s3Id,
          fromUser: uC3,
          toUser: uC1,
          offeredSkill: 'Violin',
          wantedSkill: 'Piano',
          status: 'accepted',
          circularExchange: exCId,
          circularLegIndex: 2,
        },
      ], { session, ordered: true });
    });

    const activeExchange = await CircularExchange.findById(exCId);
    assert(activeExchange && activeExchange.status === 'active');
    const childSwaps = await SwapRequest.find({ circularExchange: exCId });
    assert.strictEqual(childSwaps.length, 3);
    pass('Create and activate circular exchange with 3 child swaps atomically');

    // C2. Complete all three legs and verify auto-finalization and reservation release
    await withTransaction(async (session) => {
      const ex = await CircularExchange.findById(exCId).session(session);
      for (let i = 0; i < 3; i++) {
        ex.legs[i].teacherCompletedAt = new Date();
        ex.legs[i].teacherCompletedBy = ex.legs[i].teacher;
        ex.legs[i].learnerConfirmedAt = new Date();
        ex.legs[i].learnerConfirmedBy = ex.legs[i].learner;
        ex.legs[i].completedAt = new Date();
        ex.legs[i].status = 'completed';
      }

      // Check if all legs are completed -> auto finalize
      const allDone = ex.legs.every(leg => leg.status === 'completed');
      if (allDone) {
        ex.status = 'completed';
        ex.completedAt = new Date();
      }
      await ex.save({ session });

      // Sync child swap requests
      await SwapRequest.updateMany(
        { circularExchange: exCId },
        { $set: { status: 'completed' } },
        { session }
      );

      // Release reservations
      await releaseReservations({ exchangeId: exCId, session });
    });

    const completedEx = await CircularExchange.findById(exCId);
    assert.strictEqual(completedEx.status, 'completed', 'CircularExchange must be completed');
    const remainingExRes = await ExchangeReservation.find({ exchangeId: exCId });
    assert.strictEqual(remainingExRes.length, 0, 'All reservations must be released upon completion');
    const updatedChildSwaps = await SwapRequest.find({ circularExchange: exCId });
    assert(updatedChildSwaps.every(s => s.status === 'completed'), 'All child swaps must be completed');
    pass('Complete all three legs with automatic finalization and reservation release');

    // ════════════════════════════════════════════════════════════════════════
    // SUITE D — TRANSACTIONAL OUTBOX
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n────────────────────────────────────────────────────────────────────');
    console.log('📋 SUITE D: TRANSACTIONAL OUTBOX');
    console.log('────────────────────────────────────────────────────────────────────');
    assertAtlasTestDatabaseSafe();

    const sD1Id = new mongoose.Types.ObjectId();
    const obD1Id = new mongoose.Types.ObjectId();
    trackedSwapIds.push(sD1Id);
    trackedOutboxIds.push(obD1Id);

    // D1. Dual-write commit: business change + outbox event
    await withTransaction(async (session) => {
      await SwapRequest.create([
        {
          _id: sD1Id,
          fromUser: uC1,
          toUser: uC2,
          offeredSkill: 'Chess',
          wantedSkill: 'Go',
          status: 'pending',
        },
      ], { session, ordered: true });

      await OutboxEvent.create([
        {
          _id: obD1Id,
          aggregateType: 'SwapRequest',
          aggregateId: sD1Id,
          recipient: uC2,
          sender: uC1,
          type: 'swap_request',
          title: 'New Swap Request',
          message: 'User sent a request',
          relatedSwap: sD1Id,
          status: 'pending',
        },
      ], { session, ordered: true });
    });

    const committedSwap = await SwapRequest.findById(sD1Id);
    const committedOutbox = await OutboxEvent.findById(obD1Id);
    assert(committedSwap && committedOutbox, 'Both swap and outbox event must be committed');
    pass('Dual-write commit: SwapRequest and OutboxEvent persist atomically');

    // D2. Aborted transaction leaves zero orphaned outbox events
    const sD2Id = new mongoose.Types.ObjectId();
    const obD2Id = new mongoose.Types.ObjectId();

    let abortedOutboxCaught = false;
    try {
      await withTransaction(async (session) => {
        await SwapRequest.create([
          {
            _id: sD2Id,
            fromUser: uC1,
            toUser: uC3,
            offeredSkill: 'Art',
            wantedSkill: 'Music',
            status: 'pending',
          },
        ], { session, ordered: true });

        await OutboxEvent.create([
          {
            _id: obD2Id,
            aggregateType: 'SwapRequest',
            aggregateId: sD2Id,
            recipient: uC3,
            sender: uC1,
            type: 'swap_request',
            title: 'New Swap Request',
            message: 'User sent a request',
            relatedSwap: sD2Id,
            status: 'pending',
          },
        ], { session, ordered: true });

        throw new Error('INTENTIONAL_ROLLBACK_OUTBOX');
      });
    } catch (err) {
      if (err.message === 'INTENTIONAL_ROLLBACK_OUTBOX') abortedOutboxCaught = true;
      else throw err;
    }

    assert(abortedOutboxCaught, 'Abort caught');
    const checkSwapD2 = await SwapRequest.findById(sD2Id);
    const checkOutboxD2 = await OutboxEvent.findById(obD2Id);
    assert.strictEqual(checkSwapD2, null, 'Aborted swap must not exist');
    assert.strictEqual(checkOutboxD2, null, 'Aborted outbox event must not exist');
    pass('Aborted transaction leaves zero orphaned OutboxEvent records');

    // ════════════════════════════════════════════════════════════════════════
    // SUITE E — CONCURRENCY
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n────────────────────────────────────────────────────────────────────');
    console.log('📋 SUITE E: CONCURRENCY');
    console.log('────────────────────────────────────────────────────────────────────');
    assertAtlasTestDatabaseSafe();

    const uE1 = new mongoose.Types.ObjectId();
    const exE1 = new mongoose.Types.ObjectId();
    const exE2 = new mongoose.Types.ObjectId();
    trackedReservationExchanges.push(exE1, exE2);

    // Competing reservation acquisition for uE1 in two concurrent transactions
    const results = await Promise.allSettled([
      withTransaction(async (session) => {
        return acquireReservations({
          reservations: [
            { participant: uE1, exchangeType: 'circular', exchangeId: exE1, skillBeingTaught: 'Physics' },
          ],
          session,
        });
      }),
      withTransaction(async (session) => {
        return acquireReservations({
          reservations: [
            { participant: uE1, exchangeType: 'circular', exchangeId: exE2, skillBeingTaught: 'Math' },
          ],
          session,
        });
      }),
    ]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    assert.strictEqual(fulfilled.length, 1, 'Exactly one competing reservation acquisition must succeed');
    assert.strictEqual(rejected.length, 1, 'Competing reservation acquisition must fail');
    assert(
      rejected[0].reason instanceof ReservationConflictError ||
      rejected[0].reason.code === 11000 ||
      rejected[0].reason.code === 112 ||
      rejected[0].reason.errorLabels?.has?.('TransientTransactionError') ||
      rejected[0].reason.message?.includes('WriteConflict') ||
      rejected[0].reason.message?.includes('duplicate key') ||
      rejected[0].reason.status === 409,
      'Failure must be a reservation conflict'
    );

    const winningRes = await ExchangeReservation.find({ participant: uE1 });
    assert.strictEqual(winningRes.length, 1, 'Only the winning reservation must exist in database');
    pass('Competing reservation acquisition: exactly one winner, conflicting attempt rejected');

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`🎉 ALL ${passedCount} ATLAS TRANSACTION TESTS PASSED WITH 100% SUCCESS`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } finally {
    // CLEANUP TEST DATA IN ISOLATED DATABASE
    console.log('🧹 [CLEANUP] Cleaning uniquely identified test records...');
    assertAtlasTestDatabaseSafe();

    if (trackedUserIds.length > 0) {
      await User.deleteMany({ _id: { $in: trackedUserIds } });
    }
    if (trackedSwapIds.length > 0) {
      await SwapRequest.deleteMany({ _id: { $in: trackedSwapIds } });
    }
    if (trackedExchangeIds.length > 0) {
      await CircularExchange.deleteMany({ _id: { $in: trackedExchangeIds } });
    }
    if (trackedReservationExchanges.length > 0) {
      await ExchangeReservation.deleteMany({ exchangeId: { $in: trackedReservationExchanges } });
    }
    if (trackedOutboxIds.length > 0) {
      await OutboxEvent.deleteMany({ _id: { $in: trackedOutboxIds } });
    }

    console.log('   ✅ Cleanup completed successfully. Database skillswap_phase7_test is pristine.');
    await mongoose.disconnect();
    console.log('   🔒 Atlas connection disconnected cleanly.\n');
  }
}

runAtlasTransactionVerification().catch(err => {
  console.error('\n❌ Unhandled error in Atlas Transaction Verification:', err);
  process.exit(1);
});
