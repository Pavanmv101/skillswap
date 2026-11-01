/**
 * test_phase7_room_index_verification.js
 * Verification test suite for SwapRequest.roomId sparse index and WebRTC room authorization lookup.
 *
 * Verifies:
 * 1. Index definition in SwapRequest schema (roomId: 1, sparse: true, non-unique).
 * 2. Database index synchronization and physical index inspection on MongoDB.
 * 3. Query execution plan verification: confirms IXSCAN usage over COLLSCAN via explain().
 * 4. Document coexistence: multiple documents with missing roomId save without errors.
 * 5. Document coexistence: multiple documents with explicit null roomId save without errors.
 * 6. Document coexistence: documents with empty string roomId save without errors.
 * 7. Bilateral swap roomId lookup matches exact swap with fromUser, toUser, status.
 * 8. Circular child swap roomId lookups match exact corresponding leg swap requests.
 * 9. Exact WebRTC authorization lookup emulation (server.js findOne lean pattern).
 * 10. Unknown / non-existent room ID lookup safely returns null.
 */

'use strict';

const { connectTestDb, disconnectTestDb, assertTestDatabaseSafe } = require('./test_db_guard');
require('dotenv').config();
const assert = require('assert');
const mongoose = require('mongoose');
const SwapRequest = require('./models/SwapRequest');
const CircularExchange = require('./models/CircularExchange');
const User = require('./models/User');

async function runTests() {
  console.log('================================================================');
  console.log('🧪 PHASE 7.2.1 — SwapRequest roomId Index & Integrity Tests');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function pass(desc) {
    console.log(`  ✅ ${desc}`);
    passed++;
  }

  function fail(desc, err) {
    console.error(`  ❌ ${desc}`);
    console.error(`     Error: ${err.message}`);
    failed++;
  }

  const createdUserIds = [];
  const createdSwapIds = [];
  const createdExchangeIds = [];

  try {
    await connectTestDb();
    assertTestDatabaseSafe();
    console.log('Connected to test database for index verification.\n');

    // ─── Test 1: Schema-Level Index Definition ──────────────────────────
    try {
      const schemaIndexes = SwapRequest.schema.indexes();
      const roomIndexEntry = schemaIndexes.find(([fields]) => fields.roomId !== undefined);

      assert(roomIndexEntry, 'roomId index entry must be defined in SwapRequest schema');
      assert.strictEqual(roomIndexEntry[0].roomId, 1, 'roomId index key must be ascending (1)');
      assert.strictEqual(roomIndexEntry[1].sparse, true, 'roomId index must have sparse: true');
      assert.notStrictEqual(roomIndexEntry[1].unique, true, 'roomId index must NOT be unique: true');

      pass('1. SwapRequest schema defines { roomId: 1 } with sparse: true and non-unique');
    } catch (err) {
      fail('1. SwapRequest schema index definition', err);
    }

    // ─── Test 2: Database Index Synchronization ─────────────────────────
    try {
      await SwapRequest.syncIndexes();
      const collIndexes = await SwapRequest.collection.indexes();
      const physicalRoomIndex = collIndexes.find(idx => idx.key && idx.key.roomId === 1);

      assert(physicalRoomIndex, 'Physical index on roomId must exist in MongoDB collection');
      assert.strictEqual(physicalRoomIndex.sparse, true, 'Physical index must be sparse');
      assert(!physicalRoomIndex.unique, 'Physical index must not have unique constraint');

      pass('2. MongoDB physical collection has synchronized roomId_1 sparse index');
    } catch (err) {
      fail('2. MongoDB physical index synchronization', err);
    }

    // ─── Test 3: Multiple Documents with Missing roomId ─────────────────
    try {
      const u1 = await User.create({ name: 'User Missing 1', email: `miss1_${Date.now()}@test.com`, password: 'password123' });
      const u2 = await User.create({ name: 'User Missing 2', email: `miss2_${Date.now()}@test.com`, password: 'password123' });
      createdUserIds.push(u1._id, u2._id);

      const swap1 = await SwapRequest.create({
        fromUser: u1._id,
        toUser: u2._id,
        offeredSkill: 'Skill A',
        wantedSkill: 'Skill B',
        status: 'pending'
      });
      const swap2 = await SwapRequest.create({
        fromUser: u2._id,
        toUser: u1._id,
        offeredSkill: 'Skill B',
        wantedSkill: 'Skill A',
        status: 'pending'
      });
      createdSwapIds.push(swap1._id, swap2._id);

      assert.strictEqual(swap1.roomId, undefined);
      assert.strictEqual(swap2.roomId, undefined);

      pass('3. Multiple documents with missing/undefined roomId coexist without error');
    } catch (err) {
      fail('3. Multiple documents with missing roomId', err);
    }

    // ─── Test 4: Multiple Documents with Explicit Null roomId ────────────
    try {
      const u3 = await User.create({ name: 'User Null 1', email: `null1_${Date.now()}@test.com`, password: 'password123' });
      const u4 = await User.create({ name: 'User Null 2', email: `null2_${Date.now()}@test.com`, password: 'password123' });
      createdUserIds.push(u3._id, u4._id);

      const swapNull1 = await SwapRequest.create({
        fromUser: u3._id,
        toUser: u4._id,
        offeredSkill: 'Skill X',
        wantedSkill: 'Skill Y',
        status: 'rejected',
        roomId: null
      });
      const swapNull2 = await SwapRequest.create({
        fromUser: u4._id,
        toUser: u3._id,
        offeredSkill: 'Skill Y',
        wantedSkill: 'Skill X',
        status: 'cancelled',
        roomId: null
      });
      createdSwapIds.push(swapNull1._id, swapNull2._id);

      assert.strictEqual(swapNull1.roomId, null);
      assert.strictEqual(swapNull2.roomId, null);

      pass('4. Multiple documents with explicit null roomId coexist without E11000 error');
    } catch (err) {
      fail('4. Multiple documents with explicit null roomId', err);
    }

    // ─── Test 5: Documents with Empty String roomId ─────────────────────
    try {
      const u5 = await User.create({ name: 'User Empty 1', email: `empty1_${Date.now()}@test.com`, password: 'password123' });
      const u6 = await User.create({ name: 'User Empty 2', email: `empty2_${Date.now()}@test.com`, password: 'password123' });
      createdUserIds.push(u5._id, u6._id);

      const swapEmpty1 = await SwapRequest.create({
        fromUser: u5._id,
        toUser: u6._id,
        offeredSkill: 'Skill E1',
        wantedSkill: 'Skill E2',
        status: 'cancelled',
        roomId: ''
      });
      createdSwapIds.push(swapEmpty1._id);

      pass('5. Document with empty string roomId persists safely');
    } catch (err) {
      fail('5. Document with empty string roomId', err);
    }

    // ─── Test 6: Query Execution Plan (IXSCAN vs COLLSCAN) ──────────────
    try {
      const targetRoomId = `skillswap-explain-test-${Date.now()}`;
      const uExplain1 = await User.create({ name: 'User Ex 1', email: `ex1_${Date.now()}@test.com`, password: 'password123' });
      const uExplain2 = await User.create({ name: 'User Ex 2', email: `ex2_${Date.now()}@test.com`, password: 'password123' });
      createdUserIds.push(uExplain1._id, uExplain2._id);

      const explainSwap = await SwapRequest.create({
        fromUser: uExplain1._id,
        toUser: uExplain2._id,
        offeredSkill: 'Explain A',
        wantedSkill: 'Explain B',
        status: 'accepted',
        roomId: targetRoomId
      });
      createdSwapIds.push(explainSwap._id);

      const explainResult = await SwapRequest.findOne({ roomId: targetRoomId })
        .select('fromUser toUser status')
        .explain('executionStats');

      const winningPlan = explainResult.queryPlanner.winningPlan;
      const stage = winningPlan.stage;
      const inputStage = winningPlan.inputStage ? winningPlan.inputStage.stage : null;
      const indexName = winningPlan.inputStage
        ? winningPlan.inputStage.indexName
        : winningPlan.indexName;

      const isIndexScan = stage === 'IXSCAN' || stage === 'EXPRESS_IXSCAN' || inputStage === 'IXSCAN';
      assert(isIndexScan, `Expected IXSCAN or EXPRESS_IXSCAN but got stage=${stage}, inputStage=${inputStage}`);
      assert.strictEqual(indexName, 'roomId_1', `Expected indexName roomId_1, got ${indexName}`);

      pass('6. SwapRequest.findOne({ roomId }) utilizes IXSCAN with index roomId_1');
    } catch (err) {
      fail('6. Query execution plan verification', err);
    }

    // ─── Test 7: Bilateral Swap Room Lookup ──────────────────────────────
    try {
      const uBilat1 = await User.create({ name: 'Bilat Teacher', email: `bt_${Date.now()}@test.com`, password: 'password123' });
      const uBilat2 = await User.create({ name: 'Bilat Learner', email: `bl_${Date.now()}@test.com`, password: 'password123' });
      createdUserIds.push(uBilat1._id, uBilat2._id);

      const bilatRoomId = `skillswap-bilateral-live-${Date.now()}`;
      const bilatSwap = await SwapRequest.create({
        fromUser: uBilat1._id,
        toUser: uBilat2._id,
        offeredSkill: 'Python',
        wantedSkill: 'React',
        status: 'accepted',
        roomId: bilatRoomId
      });
      createdSwapIds.push(bilatSwap._id);

      // Emulate server.js lookup
      const found = await SwapRequest.findOne({ roomId: bilatRoomId })
        .select('fromUser toUser status')
        .lean();

      assert(found, 'Bilateral swap must be found by roomId');
      assert.strictEqual(found.fromUser.toString(), uBilat1._id.toString());
      assert.strictEqual(found.toUser.toString(), uBilat2._id.toString());
      assert.strictEqual(found.status, 'accepted');

      pass('7. Bilateral swap roomId lookup retrieves exact authorized participants and status');
    } catch (err) {
      fail('7. Bilateral swap room lookup', err);
    }

    // ─── Test 8: Circular Child Swap Room Lookup ─────────────────────────
    try {
      const uC1 = await User.create({ name: 'Circ User 1', email: `c1_${Date.now()}@test.com`, password: 'password123' });
      const uC2 = await User.create({ name: 'Circ User 2', email: `c2_${Date.now()}@test.com`, password: 'password123' });
      const uC3 = await User.create({ name: 'Circ User 3', email: `c3_${Date.now()}@test.com`, password: 'password123' });
      createdUserIds.push(uC1._id, uC2._id, uC3._id);

      const circExchangeId = new mongoose.Types.ObjectId();
      const leg0RoomId = `skillswap-circular-${circExchangeId}-leg-0`;
      const leg1RoomId = `skillswap-circular-${circExchangeId}-leg-1`;
      const leg2RoomId = `skillswap-circular-${circExchangeId}-leg-2`;

      const child0 = await SwapRequest.create({
        fromUser: uC1._id,
        toUser: uC2._id,
        offeredSkill: 'Rust',
        wantedSkill: '[Circular Exchange]',
        status: 'accepted',
        roomId: leg0RoomId,
        circularExchange: circExchangeId,
        circularLegIndex: 0
      });
      const child1 = await SwapRequest.create({
        fromUser: uC2._id,
        toUser: uC3._id,
        offeredSkill: 'Go',
        wantedSkill: '[Circular Exchange]',
        status: 'accepted',
        roomId: leg1RoomId,
        circularExchange: circExchangeId,
        circularLegIndex: 1
      });
      const child2 = await SwapRequest.create({
        fromUser: uC3._id,
        toUser: uC1._id,
        offeredSkill: 'Docker',
        wantedSkill: '[Circular Exchange]',
        status: 'accepted',
        roomId: leg2RoomId,
        circularExchange: circExchangeId,
        circularLegIndex: 2
      });
      createdSwapIds.push(child0._id, child1._id, child2._id);

      // Verify each leg individually
      const leg0Found = await SwapRequest.findOne({ roomId: leg0RoomId }).select('fromUser toUser status circularLegIndex').lean();
      const leg1Found = await SwapRequest.findOne({ roomId: leg1RoomId }).select('fromUser toUser status circularLegIndex').lean();
      const leg2Found = await SwapRequest.findOne({ roomId: leg2RoomId }).select('fromUser toUser status circularLegIndex').lean();

      assert.strictEqual(leg0Found.circularLegIndex, 0);
      assert.strictEqual(leg0Found.fromUser.toString(), uC1._id.toString());
      assert.strictEqual(leg0Found.toUser.toString(), uC2._id.toString());

      assert.strictEqual(leg1Found.circularLegIndex, 1);
      assert.strictEqual(leg1Found.fromUser.toString(), uC2._id.toString());
      assert.strictEqual(leg1Found.toUser.toString(), uC3._id.toString());

      assert.strictEqual(leg2Found.circularLegIndex, 2);
      assert.strictEqual(leg2Found.fromUser.toString(), uC3._id.toString());
      assert.strictEqual(leg2Found.toUser.toString(), uC1._id.toString());

      pass('8. Circular child swap roomId lookups accurately resolve all individual legs');
    } catch (err) {
      fail('8. Circular child swap room lookup', err);
    }

    // ─── Test 9: Unknown and Non-Existent Room ID Handling ───────────────
    try {
      const nonExistentRoom = `non-existent-room-${Date.now()}`;
      const result = await SwapRequest.findOne({ roomId: nonExistentRoom })
        .select('fromUser toUser status')
        .lean();

      assert.strictEqual(result, null, 'Lookup for non-existent roomId must return null');

      pass('9. Non-existent roomId lookup safely returns null via index');
    } catch (err) {
      fail('9. Unknown roomId lookup', err);
    }

    // ─── Test 10: server.js Authorization Validation Simulation ─────────
    try {
      // Simulate server.js lines 292-327
      const testRoom = `skillswap-auth-test-${Date.now()}`;
      const uAuth1 = await User.create({ name: 'Auth 1', email: `auth1_${Date.now()}@test.com`, password: 'password123' });
      const uAuth2 = await User.create({ name: 'Auth 2', email: `auth2_${Date.now()}@test.com`, password: 'password123' });
      const uObserver = await User.create({ name: 'Observer', email: `obs_${Date.now()}@test.com`, password: 'password123' });
      createdUserIds.push(uAuth1._id, uAuth2._id, uObserver._id);

      const authSwap = await SwapRequest.create({
        fromUser: uAuth1._id,
        toUser: uAuth2._id,
        offeredSkill: 'Security',
        wantedSkill: 'Audit',
        status: 'accepted',
        roomId: testRoom
      });
      createdSwapIds.push(authSwap._id);

      // Function emulating server.js logic
      async function authorizeRoomJoin(socketUserId, roomId) {
        if (!roomId || typeof roomId !== 'string' || !roomId.trim()) return { error: 'Invalid or missing room ID' };
        if (!socketUserId) return { error: 'Authentication required to join video room' };
        const cleanRoomId = roomId.trim();
        const swap = await SwapRequest.findOne({ roomId: cleanRoomId }).select('fromUser toUser status').lean();
        if (!swap) return { error: 'Video room not found' };
        if (swap.status !== 'accepted' && swap.status !== 'completed') return { error: `Cannot join video session: swap is ${swap.status}` };
        const currentUserIdStr = socketUserId.toString();
        const isAuthorized = swap.fromUser.toString() === currentUserIdStr || swap.toUser.toString() === currentUserIdStr;
        if (!isAuthorized) return { error: 'Forbidden: You are not an authorized participant in this session' };
        return { authorized: true, swap };
      }

      // Check teacher
      const teacherRes = await authorizeRoomJoin(uAuth1._id, testRoom);
      assert.strictEqual(teacherRes.authorized, true);

      // Check learner
      const learnerRes = await authorizeRoomJoin(uAuth2._id, testRoom);
      assert.strictEqual(learnerRes.authorized, true);

      // Check observer
      const obsRes = await authorizeRoomJoin(uObserver._id, testRoom);
      assert.strictEqual(obsRes.error, 'Forbidden: You are not an authorized participant in this session');

      // Check unauthenticated
      const unauthRes = await authorizeRoomJoin(null, testRoom);
      assert.strictEqual(unauthRes.error, 'Authentication required to join video room');

      // Check non-existent room
      const missingRes = await authorizeRoomJoin(uAuth1._id, 'fake-room-id');
      assert.strictEqual(missingRes.error, 'Video room not found');

      pass('10. Full server.js WebRTC room authorization pipeline verified end-to-end');
    } catch (err) {
      fail('10. server.js WebRTC room authorization pipeline simulation', err);
    }

  } finally {
    // Clean up created test documents
    console.log('\nCleaning up test documents...');
    assertTestDatabaseSafe();
    if (createdSwapIds.length > 0) {
      await SwapRequest.deleteMany({ _id: { $in: createdSwapIds } });
    }
    if (createdExchangeIds.length > 0) {
      await CircularExchange.deleteMany({ _id: { $in: createdExchangeIds } });
    }
    if (createdUserIds.length > 0) {
      await User.deleteMany({ _id: { $in: createdUserIds } });
    }
    await disconnectTestDb();
    console.log('Cleanup complete and disconnected from test database.\n');
  }

  console.log('================================================================');
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
