/**
 * Phase 6 — Advanced Skill Exchange Algorithm (Step 3 - Substage 3.4.3)
 * test_phase6_step3_stage3_sub6.js
 *
 * Dedicated test suite for Automatic Circular Exchange Finalization:
 * 1. First completed leg leaves parent exchange active.
 * 2. Second completed leg leaves parent exchange active.
 * 3. Third completed leg automatically finalizes parent exchange to 'completed'.
 * 4. Finalization invariant: Requires exactly 3 valid completed legs with timestamps.
 * 5. Missing child swap prevents finalization; parent remains active.
 * 6. Parent/child status mismatch prevents finalization; parent remains active.
 * 7. Duplicate confirmation does not duplicate finalization events or history.
 * 8. Concurrent final confirmations finalize parent exactly once.
 * 9. Completed parent cannot return to active; scheduling remains prohibited.
 * 10. Bilateral completion and reliability metrics remain unchanged and intact.
 * 11. Transaction rollback on outbox failure restores parent to active.
 * 12. End-to-end HTTP workflow across all three participants.
 */

'use strict';

require('dotenv').config();
const assert = require('assert');
const http = require('http');
const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const User = require('./models/User');
const CircularExchange = require('./models/CircularExchange');
const SwapRequest = require('./models/SwapRequest');
const OutboxEvent = require('./models/OutboxEvent');
const ExchangeReservation = require('./models/ExchangeReservation');

const {
  teacherCompleteLeg,
  learnerConfirmLegCompletion,
} = require('./controllers/circularCompletionController');

const {
  proposeLegSchedule,
  confirmLegSchedule,
  getCircularSchedule,
} = require('./controllers/circularSchedulingController');

const { completeSwapRequest } = require('./controllers/swapController');
const { getUserExchangeReliability } = require('./services/reliabilityService');
const { isTransactionSupported } = require('./services/reservationService');
const circularRoutes = require('./routes/circularRoutes');
const swapRoutes = require('./routes/swapRoutes');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ ${name}`);
    console.error(`     Error: ${err.message}`);
    if (err.stack) {
      console.error(err.stack.split('\n').slice(1, 4).join('\n'));
    }
    failed++;
  }
}

function mockRes() {
  const res = {
    statusCode: 200,
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

function generateToken(userId) {
  return jwt.sign(
    { id: userId.toString(), role: 'student' },
    process.env.JWT_SECRET || 'skillswap_jwt_secret_dev_key',
    { expiresIn: '1h' }
  );
}

async function createTestUser(data = {}) {
  const suffix = Math.random().toString(36).substring(2, 9);
  const u = new User({
    name: data.name || `User_${suffix}`,
    email: data.email || `user_${suffix}@test.com`,
    password: data.password || 'hashed_pw_test',
    skillsOffered: data.skillsOffered || [{ skill: 'Skill_' + suffix, level: 'Intermediate' }],
    skillsWanted: data.skillsWanted || [{ skill: 'Wanted_' + suffix, level: 'Beginner' }],
    availabilitySlots: data.availabilitySlots !== undefined ? data.availabilitySlots : [],
    timezone: data.timezone !== undefined ? data.timezone : 'Asia/Kolkata',
    blockedUsers: data.blockedUsers || [],
    averageRating: data.averageRating ?? 0,
    totalRatings: data.totalRatings ?? 0,
  });
  return u.save();
}

/**
 * Creates and activates a canonical 3-way circular exchange between users A, B, and C:
 * A teaches B (leg 0)
 * B teaches C (leg 1)
 * C teaches A (leg 2)
 */
async function createAndActivateCycle(uA, uB, uC, skills = ['Node.js', 'React', 'Python']) {
  const participants = [
    { user: uA._id, hasAccepted: true, acceptedAt: new Date() },
    { user: uB._id, hasAccepted: true, acceptedAt: new Date() },
    { user: uC._id, hasAccepted: true, acceptedAt: new Date() },
  ];

  const legs = [
    {
      legIndex: 0,
      teacher: uA._id,
      learner: uB._id,
      skill: skills[0],
      category: 'Tech',
      status: 'active',
      roomId: 'room_leg_0_' + Math.random(),
    },
    {
      legIndex: 1,
      teacher: uB._id,
      learner: uC._id,
      skill: skills[1],
      category: 'Tech',
      status: 'active',
      roomId: 'room_leg_1_' + Math.random(),
    },
    {
      legIndex: 2,
      teacher: uC._id,
      learner: uA._id,
      skill: skills[2],
      category: 'Tech',
      status: 'active',
      roomId: 'room_leg_2_' + Math.random(),
    },
  ];

  const participantIds = [uA._id, uB._id, uC._id];
  const canonicalResult = CircularExchange.validateAndCanonicalize(participantIds, legs);

  const exchange = new CircularExchange({
    initiator: uA._id,
    participants,
    legs,
    canonicalCycleHash: canonicalResult.canonicalCycleHash,
    status: 'active',
    cycleScore: 85,
    expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
    activatedAt: new Date(),
  });
  await exchange.save();

  // Create 3 child SwapRequests
  for (let i = 0; i < exchange.legs.length; i++) {
    const leg = exchange.legs[i];
    const childSwap = new SwapRequest({
      fromUser: leg.teacher,
      toUser: leg.learner,
      offeredSkill: leg.skill,
      wantedSkill: '[Circular Exchange]',
      status: 'accepted',
      roomId: leg.roomId,
      circularExchange: exchange._id,
      circularLegIndex: i,
    });
    await childSwap.save();
    exchange.legs[i].swapRequest = childSwap._id;
  }
  await exchange.save();

  return exchange;
}

/**
 * Helper to schedule a leg with confirmed status
 */
async function scheduleLeg(exchangeId, legIndex, teacherId, learnerId, futureDate) {
  const reqPropose = {
    userId: teacherId.toString(),
    params: { id: exchangeId.toString(), legIndex: String(legIndex) },
    body: { scheduledTime: futureDate.toISOString() },
  };
  const resPropose = mockRes();
  await proposeLegSchedule(reqPropose, resPropose);
  assert.strictEqual(resPropose.statusCode, 200, resPropose.body?.message);

  const proposalId = resPropose.body.proposalId;
  assert.ok(proposalId);

  const reqConfirm = {
    userId: learnerId.toString(),
    params: { id: exchangeId.toString(), legIndex: String(legIndex) },
    body: { proposalId },
  };
  const resConfirm = mockRes();
  await confirmLegSchedule(reqConfirm, resConfirm);
  assert.strictEqual(resConfirm.statusCode, 200, resConfirm.body?.message);
  assert.strictEqual(resConfirm.body.status, 'scheduled');
}

/**
 * Helper to complete a scheduled leg (teacher marks complete, learner confirms)
 */
async function completeLeg(exchangeId, legIndex, teacherId, learnerId) {
  const resT = mockRes();
  await teacherCompleteLeg(
    { userId: teacherId.toString(), params: { id: exchangeId.toString(), legIndex: String(legIndex) }, body: { notes: `Leg ${legIndex} teacher done` } },
    resT
  );
  assert.strictEqual(resT.statusCode, 200, resT.body?.message);

  const resL = mockRes();
  await learnerConfirmLegCompletion(
    { userId: learnerId.toString(), params: { id: exchangeId.toString(), legIndex: String(legIndex) }, body: { notes: `Leg ${legIndex} learner confirmed` } },
    resL
  );
  assert.strictEqual(resL.statusCode, 200, resL.body?.message);
  return resL.body;
}

let testServer = null;
let testBaseUrl = '';
let swapBaseUrl = '';

async function startHttpServer() {
  const app = express();
  app.use(express.json());
  app.use('/api/circular', circularRoutes);
  app.use('/api/swap', swapRoutes);

  await new Promise((resolve) => {
    testServer = http.createServer(app);
    testServer.listen(0, () => {
      const port = testServer.address().port;
      testBaseUrl = `http://localhost:${port}/api/circular`;
      swapBaseUrl = `http://localhost:${port}/api/swap`;
      resolve();
    });
  });
}

async function stopHttpServer() {
  if (testServer) {
    await new Promise((resolve) => testServer.close(resolve));
  }
}

async function runTests() {
  console.log('Connecting to database...');
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/skillswap_test');
  console.log(`Connected. Standalone/Transaction Mode: ${isTransactionSupported() ? 'Replica Set (ACID)' : 'Standalone (Fallback)'}`);

  await startHttpServer();

  console.log('\n--- 1. Progressive Leg Completion & Automatic Finalization Invariant ---');

  await test('1. First completed leg leaves parent exchange status active', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const exchange = await createAndActivateCycle(uA, uB, uC);
    const cycleId = exchange._id.toString();

    // Schedule all 3 legs
    await scheduleLeg(cycleId, 0, uA._id, uB._id, new Date(Date.now() + 24 * 3600 * 1000));
    await scheduleLeg(cycleId, 1, uB._id, uC._id, new Date(Date.now() + 48 * 3600 * 1000));
    await scheduleLeg(cycleId, 2, uC._id, uA._id, new Date(Date.now() + 72 * 3600 * 1000));

    // Complete Leg 0
    const bodyL0 = await completeLeg(cycleId, 0, uA._id, uB._id);
    assert.strictEqual(bodyL0.status, 'completed');
    assert.strictEqual(bodyL0.exchangeStatus, 'active');
    assert.strictEqual(bodyL0.exchangeFinalized, false);

    const refreshed = await CircularExchange.findById(cycleId);
    assert.strictEqual(refreshed.status, 'active');
    assert.strictEqual(refreshed.completedAt, null);
    assert.strictEqual(refreshed.finalizationHistory.length, 0);

    // Verify zero parent completion outbox events
    const parentEvents = await OutboxEvent.find({
      aggregateId: exchange._id,
      type: 'CIRCULAR_EXCHANGE_COMPLETED',
    });
    assert.strictEqual(parentEvents.length, 0);
  });

  await test('2. Second completed leg leaves parent exchange status active', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const exchange = await createAndActivateCycle(uA, uB, uC);
    const cycleId = exchange._id.toString();

    await scheduleLeg(cycleId, 0, uA._id, uB._id, new Date(Date.now() + 24 * 3600 * 1000));
    await scheduleLeg(cycleId, 1, uB._id, uC._id, new Date(Date.now() + 48 * 3600 * 1000));
    await scheduleLeg(cycleId, 2, uC._id, uA._id, new Date(Date.now() + 72 * 3600 * 1000));

    await completeLeg(cycleId, 0, uA._id, uB._id);
    const bodyL1 = await completeLeg(cycleId, 1, uB._id, uC._id);

    assert.strictEqual(bodyL1.status, 'completed');
    assert.strictEqual(bodyL1.exchangeStatus, 'active');
    assert.strictEqual(bodyL1.exchangeFinalized, false);

    const refreshed = await CircularExchange.findById(cycleId);
    assert.strictEqual(refreshed.status, 'active');
    assert.strictEqual(refreshed.completedAt, null);
    assert.strictEqual(refreshed.finalizationHistory.length, 0);

    const parentEvents = await OutboxEvent.find({
      aggregateId: exchange._id,
      type: 'CIRCULAR_EXCHANGE_COMPLETED',
    });
    assert.strictEqual(parentEvents.length, 0);
  });

  await test('3. Third completed leg automatically finalizes parent exchange', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const exchange = await createAndActivateCycle(uA, uB, uC);
    const cycleId = exchange._id.toString();

    await scheduleLeg(cycleId, 0, uA._id, uB._id, new Date(Date.now() + 24 * 3600 * 1000));
    await scheduleLeg(cycleId, 1, uB._id, uC._id, new Date(Date.now() + 48 * 3600 * 1000));
    await scheduleLeg(cycleId, 2, uC._id, uA._id, new Date(Date.now() + 72 * 3600 * 1000));

    await completeLeg(cycleId, 0, uA._id, uB._id);
    await completeLeg(cycleId, 1, uB._id, uC._id);

    // Complete Leg 2: Learner uA confirms completion
    const bodyL2 = await completeLeg(cycleId, 2, uC._id, uA._id);
    assert.strictEqual(bodyL2.status, 'completed');
    assert.strictEqual(bodyL2.exchangeStatus, 'completed');
    assert.strictEqual(bodyL2.exchangeFinalized, true);
    assert.ok(bodyL2.exchangeCompletedAt);

    // Inspect finalized parent CircularExchange
    const refreshed = await CircularExchange.findById(cycleId);
    assert.strictEqual(refreshed.status, 'completed');
    assert.ok(refreshed.completedAt);
    assert.strictEqual(refreshed.completedBy.toString(), uA._id.toString());
    assert.strictEqual(refreshed.finalizationHistory.length, 1);
    assert.strictEqual(refreshed.finalizationHistory[0].legs.length, 3);
    assert.strictEqual(refreshed.finalizationHistory[0].actionBy.toString(), uA._id.toString());

    // Verify all 3 participants received CIRCULAR_EXCHANGE_COMPLETED outbox event
    const parentEvents = await OutboxEvent.find({
      aggregateId: exchange._id,
      type: 'CIRCULAR_EXCHANGE_COMPLETED',
    });
    assert.strictEqual(parentEvents.length, 3);
    const recipientIds = parentEvents.map(e => e.recipient.toString());
    assert(recipientIds.includes(uA._id.toString()));
    assert(recipientIds.includes(uB._id.toString()));
    assert(recipientIds.includes(uC._id.toString()));
  });

  console.log('\n--- 2. Invariant Validation & Incomplete State Protection ---');

  await test('4. Missing teacherCompletedAt or learnerConfirmedAt on any leg prevents finalization', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const exchange = await createAndActivateCycle(uA, uB, uC);
    const cycleId = exchange._id.toString();

    await scheduleLeg(cycleId, 0, uA._id, uB._id, new Date(Date.now() + 24 * 3600 * 1000));
    await scheduleLeg(cycleId, 1, uB._id, uC._id, new Date(Date.now() + 48 * 3600 * 1000));
    await scheduleLeg(cycleId, 2, uC._id, uA._id, new Date(Date.now() + 72 * 3600 * 1000));

    // Manually complete leg 0 without teacherCompletedAt timestamp
    await CircularExchange.updateOne(
      { _id: exchange._id },
      {
        $set: {
          'legs.0.status': 'completed',
          'legs.0.teacherCompletedAt': null, // Missing!
          'legs.0.learnerConfirmedAt': new Date(),
        },
      }
    );
    await SwapRequest.updateOne({ _id: exchange.legs[0].swapRequest }, { $set: { status: 'completed' } });

    await completeLeg(cycleId, 1, uB._id, uC._id);
    await completeLeg(cycleId, 2, uC._id, uA._id);

    // Parent must NOT finalize due to missing timestamp invariant
    const refreshed = await CircularExchange.findById(cycleId);
    assert.strictEqual(refreshed.status, 'active');
    assert.strictEqual(refreshed.completedAt, null);
  });

  await test('5. Missing child SwapRequest prevents finalization', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const exchange = await createAndActivateCycle(uA, uB, uC);
    const cycleId = exchange._id.toString();

    await scheduleLeg(cycleId, 0, uA._id, uB._id, new Date(Date.now() + 24 * 3600 * 1000));
    await scheduleLeg(cycleId, 1, uB._id, uC._id, new Date(Date.now() + 48 * 3600 * 1000));
    await scheduleLeg(cycleId, 2, uC._id, uA._id, new Date(Date.now() + 72 * 3600 * 1000));

    // Delete child swap for leg 0
    await SwapRequest.deleteOne({ _id: exchange.legs[0].swapRequest });

    // Manually set leg 0 completed
    await CircularExchange.updateOne(
      { _id: exchange._id },
      {
        $set: {
          'legs.0.status': 'completed',
          'legs.0.teacherCompletedAt': new Date(),
          'legs.0.learnerConfirmedAt': new Date(),
        },
      }
    );

    await completeLeg(cycleId, 1, uB._id, uC._id);
    await completeLeg(cycleId, 2, uC._id, uA._id);

    // Invariant fails: exactly 3 child swaps must exist
    const refreshed = await CircularExchange.findById(cycleId);
    assert.strictEqual(refreshed.status, 'active');
  });

  await test('6. Parent/child status mismatch prevents finalization', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const exchange = await createAndActivateCycle(uA, uB, uC);
    const cycleId = exchange._id.toString();

    await scheduleLeg(cycleId, 0, uA._id, uB._id, new Date(Date.now() + 24 * 3600 * 1000));
    await scheduleLeg(cycleId, 1, uB._id, uC._id, new Date(Date.now() + 48 * 3600 * 1000));
    await scheduleLeg(cycleId, 2, uC._id, uA._id, new Date(Date.now() + 72 * 3600 * 1000));

    // Leg 0 is marked completed on parent, but child swap is reverted to 'accepted'
    await CircularExchange.updateOne(
      { _id: exchange._id },
      {
        $set: {
          'legs.0.status': 'completed',
          'legs.0.teacherCompletedAt': new Date(),
          'legs.0.learnerConfirmedAt': new Date(),
        },
      }
    );
    await SwapRequest.updateOne({ _id: exchange.legs[0].swapRequest }, { $set: { status: 'accepted' } });

    await completeLeg(cycleId, 1, uB._id, uC._id);
    await completeLeg(cycleId, 2, uC._id, uA._id);

    // Invariant fails: child swap status !== 'completed'
    const refreshed = await CircularExchange.findById(cycleId);
    assert.strictEqual(refreshed.status, 'active');
  });

  console.log('\n--- 3. Idempotency & Concurrency of Finalization ---');

  await test('7. Duplicate confirmation does not duplicate finalization events or history', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const exchange = await createAndActivateCycle(uA, uB, uC);
    const cycleId = exchange._id.toString();

    await scheduleLeg(cycleId, 0, uA._id, uB._id, new Date(Date.now() + 24 * 3600 * 1000));
    await scheduleLeg(cycleId, 1, uB._id, uC._id, new Date(Date.now() + 48 * 3600 * 1000));
    await scheduleLeg(cycleId, 2, uC._id, uA._id, new Date(Date.now() + 72 * 3600 * 1000));

    await completeLeg(cycleId, 0, uA._id, uB._id);
    await completeLeg(cycleId, 1, uB._id, uC._id);
    await completeLeg(cycleId, 2, uC._id, uA._id);

    // Call 2: Duplicate learner confirmation on Leg 2
    const resDup = mockRes();
    await learnerConfirmLegCompletion(
      { userId: uA._id.toString(), params: { id: cycleId, legIndex: '2' }, body: {} },
      resDup
    );
    assert.strictEqual(resDup.statusCode, 200);
    assert.strictEqual(resDup.body.exchangeFinalized, true);

    // Verify finalizationHistory length: exactly 1
    const refreshed = await CircularExchange.findById(cycleId);
    assert.strictEqual(refreshed.status, 'completed');
    assert.strictEqual(refreshed.finalizationHistory.length, 1);

    // Verify outbox events: still exactly 3
    const parentEvents = await OutboxEvent.find({
      aggregateId: exchange._id,
      type: 'CIRCULAR_EXCHANGE_COMPLETED',
    });
    assert.strictEqual(parentEvents.length, 3);
  });

  await test('8. Concurrent final confirmations finalize parent exactly once', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const exchange = await createAndActivateCycle(uA, uB, uC);
    const cycleId = exchange._id.toString();

    await scheduleLeg(cycleId, 0, uA._id, uB._id, new Date(Date.now() + 24 * 3600 * 1000));
    await scheduleLeg(cycleId, 1, uB._id, uC._id, new Date(Date.now() + 48 * 3600 * 1000));
    await scheduleLeg(cycleId, 2, uC._id, uA._id, new Date(Date.now() + 72 * 3600 * 1000));

    await completeLeg(cycleId, 0, uA._id, uB._id);
    await completeLeg(cycleId, 1, uB._id, uC._id);

    // Teacher completes leg 2
    const resT2 = mockRes();
    await teacherCompleteLeg({ userId: uC._id.toString(), params: { id: cycleId, legIndex: '2' } }, resT2);
    assert.strictEqual(resT2.statusCode, 200);

    // Run two simultaneous learner confirmations for Leg 2
    const [res1, res2] = await Promise.all([
      (async () => {
        const r = mockRes();
        await learnerConfirmLegCompletion({ userId: uA._id.toString(), params: { id: cycleId, legIndex: '2' } }, r);
        return r;
      })(),
      (async () => {
        const r = mockRes();
        await learnerConfirmLegCompletion({ userId: uA._id.toString(), params: { id: cycleId, legIndex: '2' } }, r);
        return r;
      })(),
    ]);

    assert.strictEqual(res1.statusCode, 200);
    assert.strictEqual(res2.statusCode, 200);

    const refreshed = await CircularExchange.findById(cycleId);
    assert.strictEqual(refreshed.status, 'completed');
    assert.strictEqual(refreshed.finalizationHistory.length, 1);

    const parentEvents = await OutboxEvent.find({
      aggregateId: exchange._id,
      type: 'CIRCULAR_EXCHANGE_COMPLETED',
    });
    assert.strictEqual(parentEvents.length, 3);
  });

  console.log('\n--- 4. Post-Finalization Immutability & Safety ---');

  await test('9. Completed parent cannot return to active; scheduling remains prohibited', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const exchange = await createAndActivateCycle(uA, uB, uC);
    const cycleId = exchange._id.toString();

    await scheduleLeg(cycleId, 0, uA._id, uB._id, new Date(Date.now() + 24 * 3600 * 1000));
    await scheduleLeg(cycleId, 1, uB._id, uC._id, new Date(Date.now() + 48 * 3600 * 1000));
    await scheduleLeg(cycleId, 2, uC._id, uA._id, new Date(Date.now() + 72 * 3600 * 1000));

    await completeLeg(cycleId, 0, uA._id, uB._id);
    await completeLeg(cycleId, 1, uB._id, uC._id);
    await completeLeg(cycleId, 2, uC._id, uA._id);

    // Attempt to propose schedule on completed exchange
    const resPropose = mockRes();
    await proposeLegSchedule(
      { userId: uA._id.toString(), params: { id: cycleId, legIndex: '0' }, body: { scheduledTime: new Date(Date.now() + 96 * 3600 * 1000).toISOString() } },
      resPropose
    );
    assert.strictEqual(resPropose.statusCode, 400);
    assert(resPropose.body.message.includes('completed'));

    // Attempt to confirm schedule on completed exchange
    const resConfirm = mockRes();
    await confirmLegSchedule(
      { userId: uB._id.toString(), params: { id: cycleId, legIndex: '0' }, body: { proposalId: 'any-id' } },
      resConfirm
    );
    assert.strictEqual(resConfirm.statusCode, 400);
    assert(resConfirm.body.message.includes('completed'));

    const refreshed = await CircularExchange.findById(cycleId);
    assert.strictEqual(refreshed.status, 'completed');
  });

  await test('10. Bilateral completion and reliability remain unchanged', async () => {
    const u1 = await createTestUser();
    const u2 = await createTestUser();

    const swap = new SwapRequest({
      fromUser: u1._id,
      toUser: u2._id,
      offeredSkill: 'Cooking',
      wantedSkill: 'Baking',
      status: 'accepted',
      scheduledAt: new Date(Date.now() + 24 * 3600 * 1000),
      circularExchange: null,
    });
    await swap.save();

    await ExchangeReservation.create([
      { participant: u1._id, exchangeType: 'bilateral', exchangeId: swap._id, skillBeingTaught: 'Cooking' },
      { participant: u2._id, exchangeType: 'bilateral', exchangeId: swap._id, skillBeingTaught: 'Baking' },
    ]);

    const res = mockRes();
    await completeSwapRequest({ userId: u1._id.toString(), params: { id: swap._id.toString() } }, res);
    assert.strictEqual(res.statusCode, 200);

    const rel1 = await getUserExchangeReliability(u1._id);
    const rel2 = await getUserExchangeReliability(u2._id);
    assert.strictEqual(rel1.completedCount, 1);
    assert.strictEqual(rel2.completedCount, 1);
  });

  console.log('\n--- 5. Transaction Rollback on Finalization Failure ---');

  await test('11. Outbox failure during finalization rolls back parent exchange to active', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const exchange = await createAndActivateCycle(uA, uB, uC);
    const cycleId = exchange._id.toString();

    await scheduleLeg(cycleId, 0, uA._id, uB._id, new Date(Date.now() + 24 * 3600 * 1000));
    await scheduleLeg(cycleId, 1, uB._id, uC._id, new Date(Date.now() + 48 * 3600 * 1000));
    await scheduleLeg(cycleId, 2, uC._id, uA._id, new Date(Date.now() + 72 * 3600 * 1000));

    await completeLeg(cycleId, 0, uA._id, uB._id);
    await completeLeg(cycleId, 1, uB._id, uC._id);

    // Teacher completes leg 2
    const resT2 = mockRes();
    await teacherCompleteLeg({ userId: uC._id.toString(), params: { id: cycleId, legIndex: '2' } }, resT2);
    assert.strictEqual(resT2.statusCode, 200);

    // Monkey-patch OutboxEvent.insertMany to fail during finalization outbox write
    const originalInsertMany = OutboxEvent.insertMany;
    OutboxEvent.insertMany = async function () {
      throw new Error('Simulated Finalization Outbox Failure');
    };

    try {
      const resL2 = mockRes();
      await learnerConfirmLegCompletion({ userId: uA._id.toString(), params: { id: cycleId, legIndex: '2' } }, resL2);
      assert.strictEqual(resL2.statusCode, 500);

      // Verify rollback: parent exchange remains 'active'
      const refreshed = await CircularExchange.findById(cycleId);
      assert.strictEqual(refreshed.status, 'active');
      assert.strictEqual(refreshed.completedAt, null);
      assert.strictEqual(refreshed.finalizationHistory.length, 0);

      // Verify leg 2 rolled back to 'teacher_completed'
      assert.strictEqual(refreshed.legs[2].status, 'teacher_completed');
    } finally {
      OutboxEvent.insertMany = originalInsertMany;
    }
  });

  console.log('\n--- 6. End-to-End HTTP Finalization Across All Participants ---');

  await test('12. End-to-End HTTP: All three legs completed over HTTP automatically finalizes parent exchange', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const exchange = await createAndActivateCycle(uA, uB, uC, ['Express', 'React', 'MongoDB']);
    const cycleId = exchange._id.toString();

    const tokenA = generateToken(uA._id);
    const tokenB = generateToken(uB._id);
    const tokenC = generateToken(uC._id);

    // Schedule all 3 legs via HTTP
    const d0 = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const d1 = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
    const d2 = new Date(Date.now() + 72 * 3600 * 1000).toISOString();

    // Leg 0: A proposes, B confirms
    const p0Res = await fetch(`${testBaseUrl}/${cycleId}/legs/0/schedule/propose`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ scheduledTime: d0 }),
    });
    assert.strictEqual(p0Res.status, 200);
    const p0Data = await p0Res.json();
    await fetch(`${testBaseUrl}/${cycleId}/legs/0/schedule/confirm`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenB}` },
      body: JSON.stringify({ proposalId: p0Data.proposalId }),
    });

    // Leg 1: B proposes, C confirms
    const p1Res = await fetch(`${testBaseUrl}/${cycleId}/legs/1/schedule/propose`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenB}` },
      body: JSON.stringify({ scheduledTime: d1 }),
    });
    assert.strictEqual(p1Res.status, 200);
    const p1Data = await p1Res.json();
    await fetch(`${testBaseUrl}/${cycleId}/legs/1/schedule/confirm`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenC}` },
      body: JSON.stringify({ proposalId: p1Data.proposalId }),
    });

    // Leg 2: C proposes, A confirms
    const p2Res = await fetch(`${testBaseUrl}/${cycleId}/legs/2/schedule/propose`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenC}` },
      body: JSON.stringify({ scheduledTime: d2 }),
    });
    assert.strictEqual(p2Res.status, 200);
    const p2Data = await p2Res.json();
    await fetch(`${testBaseUrl}/${cycleId}/legs/2/schedule/confirm`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ proposalId: p2Data.proposalId }),
    });

    // Complete Leg 0: A completes, B confirms
    await fetch(`${testBaseUrl}/${cycleId}/legs/0/complete`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ notes: 'HTTP leg 0 teacher complete' }),
    });
    await fetch(`${testBaseUrl}/${cycleId}/legs/0/complete/confirm`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenB}` },
      body: JSON.stringify({ notes: 'HTTP leg 0 learner confirmed' }),
    });

    // Complete Leg 1: B completes, C confirms
    await fetch(`${testBaseUrl}/${cycleId}/legs/1/complete`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenB}` },
      body: JSON.stringify({ notes: 'HTTP leg 1 teacher complete' }),
    });
    await fetch(`${testBaseUrl}/${cycleId}/legs/1/complete/confirm`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenC}` },
      body: JSON.stringify({ notes: 'HTTP leg 1 learner confirmed' }),
    });

    // Complete Leg 2: C completes, A confirms -> triggers automatic parent finalization!
    await fetch(`${testBaseUrl}/${cycleId}/legs/2/complete`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenC}` },
      body: JSON.stringify({ notes: 'HTTP leg 2 teacher complete' }),
    });
    const finalConfirmRes = await fetch(`${testBaseUrl}/${cycleId}/legs/2/complete/confirm`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ notes: 'HTTP leg 2 learner confirmed - final!' }),
    });
    assert.strictEqual(finalConfirmRes.status, 200);
    const finalData = await finalConfirmRes.json();
    assert.strictEqual(finalData.status, 'completed');
    assert.strictEqual(finalData.exchangeStatus, 'completed');
    assert.strictEqual(finalData.exchangeFinalized, true);
    assert.ok(finalData.exchangeCompletedAt);

    // Verify parent exchange overview via HTTP GET /api/circular/:id/schedule
    const scheduleRes = await fetch(`${testBaseUrl}/${cycleId}/schedule`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert.strictEqual(scheduleRes.status, 200);
    const schedData = await scheduleRes.json();
    assert.strictEqual(schedData.status, 'completed');
    assert.strictEqual(schedData.legs[0].status, 'completed');
    assert.strictEqual(schedData.legs[1].status, 'completed');
    assert.strictEqual(schedData.legs[2].status, 'completed');
  });

  console.log('\n--- Teardown Test Data ---');
  await stopHttpServer();
  await CircularExchange.deleteMany({});
  await SwapRequest.deleteMany({});
  await OutboxEvent.deleteMany({});
  await ExchangeReservation.deleteMany({});
  await User.deleteMany({ email: /@test\.com$/ });
  await mongoose.disconnect();
  console.log('  🧹 Teardown complete.');

  console.log('\n================================================================');
  console.log(`Substage 3.4.3 Test Results: ${passed} passed, ${failed} failed`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
