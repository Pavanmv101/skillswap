/**
 * Phase 6 — Advanced Skill Exchange Algorithm (Step 3 - Substage 3.4.2)
 * test_phase6_step3_stage3_sub5.js
 *
 * Dedicated test suite for Learner-Confirmed Circular Leg Completion:
 * 1. Teacher completion success: scheduled → teacher_completed with history & outbox.
 * 2. Learner confirmation success: teacher_completed → completed with history & outbox.
 * 3. Unauthorized actions: Learner cannot mark teacher-completed; Teacher cannot confirm.
 * 4. Nonparticipant access: Outsider and observer participants blocked with 403 Forbidden.
 * 5. Completion order guard: Learner cannot confirm before teacher marks completed (400).
 * 6. Unscheduled leg guard: Cannot complete unscheduled leg (400).
 * 7. Idempotency: Repeated completion and confirmation calls return 200 with zero duplicate records.
 * 8. Concurrency: Simultaneous requests do not create duplicate completion entries.
 * 9. Parent-child consistency: Child swap remains 'accepted' in teacher_completed, reaches 'completed' upon confirmation.
 * 10. Reliability attribution: Teacher credited only upon learner confirmation; learner not credited for learning leg; zero double-counting.
 * 11. Transaction rollback: Outbox failure triggers rollback of completion state.
 * 12. Bilateral regression: Bilateral PUT /api/swap/:id/complete continues to function untouched.
 * 13. Independent completion of all three circular legs: Each leg completes independently; parent exchange remains active.
 * 14. End-to-end HTTP: Complete lifecycle verified over real Express HTTP server.
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
  assert.strictEqual(resPropose.statusCode, 200);

  const proposalId = resPropose.body.proposalId;
  assert.ok(proposalId);

  const reqConfirm = {
    userId: learnerId.toString(),
    params: { id: exchangeId.toString(), legIndex: String(legIndex) },
    body: { proposalId },
  };
  const resConfirm = mockRes();
  await confirmLegSchedule(reqConfirm, resConfirm);
  assert.strictEqual(resConfirm.statusCode, 200);
  assert.strictEqual(resConfirm.body.status, 'scheduled');
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

  console.log('\n--- 1. Teacher Completion Success ---');

  await test('Teacher marks leg as teacher-completed with timestamp, actor, and outbox event', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const exchange = await createAndActivateCycle(uA, uB, uC);
    const sessionDate = new Date(Date.now() + 48 * 3600 * 1000);
    await scheduleLeg(exchange._id, 0, uA._id, uB._id, sessionDate);

    const reqComplete = {
      userId: uA._id.toString(),
      params: { id: exchange._id.toString(), legIndex: '0' },
      body: { notes: 'Finished teaching Express fundamentals' },
    };
    const resComplete = mockRes();
    await teacherCompleteLeg(reqComplete, resComplete);

    assert.strictEqual(resComplete.statusCode, 200);
    assert.strictEqual(resComplete.body.status, 'teacher_completed');
    assert.strictEqual(resComplete.body.legIndex, 0);
    assert.ok(resComplete.body.teacherCompletedAt);
    assert.strictEqual(new Date(resComplete.body.scheduledAt).getTime(), sessionDate.getTime());

    // Verify database state on parent CircularExchange
    const refreshed = await CircularExchange.findById(exchange._id);
    const leg0 = refreshed.legs[0];
    assert.strictEqual(leg0.status, 'teacher_completed');
    assert.ok(leg0.teacherCompletedAt);
    assert.strictEqual(leg0.teacherCompletedBy.toString(), uA._id.toString());
    assert.strictEqual(leg0.learnerConfirmedAt, null);
    assert.strictEqual(leg0.completedAt, null);
    assert.strictEqual(leg0.completionHistory.length, 1);
    assert.strictEqual(leg0.completionHistory[0].status, 'teacher_completed');
    assert.strictEqual(leg0.completionHistory[0].actionBy.toString(), uA._id.toString());
    assert.strictEqual(leg0.completionHistory[0].notes, 'Finished teaching Express fundamentals');

    // Child SwapRequest status MUST remain 'accepted' until learner confirms!
    const childSwap = await SwapRequest.findById(leg0.swapRequest);
    assert.strictEqual(childSwap.status, 'accepted');

    // Transactional OutboxEvent for the learner
    const outbox = await OutboxEvent.findOne({
      aggregateType: 'circular_exchange',
      aggregateId: exchange._id,
      recipient: uB._id,
      type: 'CIRCULAR_LEG_TEACHER_COMPLETED',
    });
    assert.ok(outbox);
    assert.strictEqual(outbox.sender.toString(), uA._id.toString());
    assert(outbox.message.includes('completed'));
  });

  console.log('\n--- 2. Learner Confirmation Success ---');

  await test('Learner confirms completion: leg and child swap become completed', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const exchange = await createAndActivateCycle(uA, uB, uC);
    const sessionDate = new Date(Date.now() + 48 * 3600 * 1000);
    await scheduleLeg(exchange._id, 0, uA._id, uB._id, sessionDate);

    // Teacher marks completed
    const reqT = {
      userId: uA._id.toString(),
      params: { id: exchange._id.toString(), legIndex: '0' },
      body: { notes: 'Session done' },
    };
    const resT = mockRes();
    await teacherCompleteLeg(reqT, resT);
    assert.strictEqual(resT.statusCode, 200);

    // Learner confirms completion
    const reqL = {
      userId: uB._id.toString(),
      params: { id: exchange._id.toString(), legIndex: '0' },
      body: { notes: 'Great lesson, learned a lot!' },
    };
    const resL = mockRes();
    await learnerConfirmLegCompletion(reqL, resL);

    assert.strictEqual(resL.statusCode, 200);
    assert.strictEqual(resL.body.status, 'completed');
    assert.ok(resL.body.learnerConfirmedAt);
    assert.ok(resL.body.completedAt);
    assert.strictEqual(resL.body.completionHistory.length, 2);

    // Verify parent exchange leg in MongoDB
    const refreshed = await CircularExchange.findById(exchange._id);
    const leg0 = refreshed.legs[0];
    assert.strictEqual(leg0.status, 'completed');
    assert.ok(leg0.teacherCompletedAt);
    assert.ok(leg0.learnerConfirmedAt);
    assert.ok(leg0.completedAt);
    assert.strictEqual(leg0.learnerConfirmedBy.toString(), uB._id.toString());
    assert.strictEqual(leg0.completionHistory.length, 2);
    assert.strictEqual(leg0.completionHistory[1].status, 'completed');
    assert.strictEqual(leg0.completionHistory[1].actionBy.toString(), uB._id.toString());
    assert.strictEqual(leg0.completionHistory[1].notes, 'Great lesson, learned a lot!');

    // Parent exchange status remains active (finalization is out of scope)
    assert.strictEqual(refreshed.status, 'active');

    // Child SwapRequest status is now synchronized to 'completed'
    const childSwap = await SwapRequest.findById(leg0.swapRequest);
    assert.strictEqual(childSwap.status, 'completed');

    // OutboxEvent for the teacher
    const outbox = await OutboxEvent.findOne({
      aggregateType: 'circular_exchange',
      aggregateId: exchange._id,
      recipient: uA._id,
      type: 'CIRCULAR_LEG_COMPLETED',
    });
    assert.ok(outbox);
    assert.strictEqual(outbox.sender.toString(), uB._id.toString());
    assert(outbox.title.includes('Confirmed Complete'));
  });

  console.log('\n--- 3. Strict Authorization & Role Enforcement ---');

  await test('Learner cannot mark teaching leg as teacher-completed (403 Forbidden)', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const exchange = await createAndActivateCycle(uA, uB, uC);
    const sessionDate = new Date(Date.now() + 48 * 3600 * 1000);
    await scheduleLeg(exchange._id, 0, uA._id, uB._id, sessionDate);

    // Learner uB calls teacher complete
    const req = {
      userId: uB._id.toString(),
      params: { id: exchange._id.toString(), legIndex: '0' },
      body: {},
    };
    const res = mockRes();
    await teacherCompleteLeg(req, res);

    assert.strictEqual(res.statusCode, 403);
    assert(res.body.message.includes('Only the teacher of this leg'));
  });

  await test('Teacher cannot confirm completion of their own teaching leg (403 Forbidden)', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const exchange = await createAndActivateCycle(uA, uB, uC);
    const sessionDate = new Date(Date.now() + 48 * 3600 * 1000);
    await scheduleLeg(exchange._id, 0, uA._id, uB._id, sessionDate);

    // Teacher marks complete
    const resT = mockRes();
    await teacherCompleteLeg({ userId: uA._id.toString(), params: { id: exchange._id.toString(), legIndex: '0' } }, resT);
    assert.strictEqual(resT.statusCode, 200);

    // Teacher uA tries to confirm completion
    const req = {
      userId: uA._id.toString(),
      params: { id: exchange._id.toString(), legIndex: '0' },
      body: {},
    };
    const res = mockRes();
    await learnerConfirmLegCompletion(req, res);

    assert.strictEqual(res.statusCode, 403);
    assert(res.body.message.includes('Only the learner of this leg'));
  });

  console.log('\n--- 4. Nonparticipant & Observer Access Control ---');

  await test('Observer participant Charlie cannot complete or confirm Leg 0 (403 Forbidden)', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const exchange = await createAndActivateCycle(uA, uB, uC);
    const sessionDate = new Date(Date.now() + 48 * 3600 * 1000);
    await scheduleLeg(exchange._id, 0, uA._id, uB._id, sessionDate);

    // Charlie tries teacher completion on leg 0
    const resCharlieT = mockRes();
    await teacherCompleteLeg({ userId: uC._id.toString(), params: { id: exchange._id.toString(), legIndex: '0' } }, resCharlieT);
    assert.strictEqual(resCharlieT.statusCode, 403);

    // Teacher marks complete
    const resT = mockRes();
    await teacherCompleteLeg({ userId: uA._id.toString(), params: { id: exchange._id.toString(), legIndex: '0' } }, resT);
    assert.strictEqual(resT.statusCode, 200);

    // Charlie tries learner confirm on leg 0
    const resCharlieL = mockRes();
    await learnerConfirmLegCompletion({ userId: uC._id.toString(), params: { id: exchange._id.toString(), legIndex: '0' } }, resCharlieL);
    assert.strictEqual(resCharlieL.statusCode, 403);
  });

  await test('Outsider user cannot complete or confirm any leg (403 Forbidden)', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();
    const outsider = await createTestUser();

    const exchange = await createAndActivateCycle(uA, uB, uC);
    const sessionDate = new Date(Date.now() + 48 * 3600 * 1000);
    await scheduleLeg(exchange._id, 0, uA._id, uB._id, sessionDate);

    const resOutsider = mockRes();
    await teacherCompleteLeg({ userId: outsider._id.toString(), params: { id: exchange._id.toString(), legIndex: '0' } }, resOutsider);
    assert.strictEqual(resOutsider.statusCode, 403);
    assert(resOutsider.body.message.includes('not a participant'));
  });

  console.log('\n--- 5. Lifecycle Order & State Transition Guards ---');

  await test('Learner cannot confirm completion before teacher marks completed (400 Bad Request)', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const exchange = await createAndActivateCycle(uA, uB, uC);
    const sessionDate = new Date(Date.now() + 48 * 3600 * 1000);
    await scheduleLeg(exchange._id, 0, uA._id, uB._id, sessionDate);

    // Leg is currently 'scheduled'. Learner uB tries to confirm directly:
    const req = {
      userId: uB._id.toString(),
      params: { id: exchange._id.toString(), legIndex: '0' },
      body: {},
    };
    const res = mockRes();
    await learnerConfirmLegCompletion(req, res);

    assert.strictEqual(res.statusCode, 400);
    assert(res.body.message.includes('Teacher has not marked this leg completed yet'));

    // Leg remains 'scheduled'
    const refreshed = await CircularExchange.findById(exchange._id);
    assert.strictEqual(refreshed.legs[0].status, 'scheduled');
  });

  await test('Unscheduled leg cannot be marked completed by teacher (400 Bad Request)', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    // Exchange activated, but Leg 0 is in 'active' unscheduled status
    const exchange = await createAndActivateCycle(uA, uB, uC);

    const req = {
      userId: uA._id.toString(),
      params: { id: exchange._id.toString(), legIndex: '0' },
      body: {},
    };
    const res = mockRes();
    await teacherCompleteLeg(req, res);

    assert.strictEqual(res.statusCode, 400);
    assert(res.body.message.includes('leg must be scheduled first'));

    const refreshed = await CircularExchange.findById(exchange._id);
    assert.strictEqual(refreshed.legs[0].status, 'active');
  });

  await test('Rescheduling is rejected if leg is already completed or teacher_completed (400)', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const exchange = await createAndActivateCycle(uA, uB, uC);
    const sessionDate = new Date(Date.now() + 48 * 3600 * 1000);
    await scheduleLeg(exchange._id, 0, uA._id, uB._id, sessionDate);

    // Teacher completes
    const resT = mockRes();
    await teacherCompleteLeg({ userId: uA._id.toString(), params: { id: exchange._id.toString(), legIndex: '0' } }, resT);
    assert.strictEqual(resT.statusCode, 200);

    // Attempting to propose a new schedule on teacher_completed leg is rejected
    const resPropose = mockRes();
    await proposeLegSchedule({
      userId: uA._id.toString(),
      params: { id: exchange._id.toString(), legIndex: '0' },
      body: { scheduledTime: new Date(Date.now() + 72 * 3600 * 1000).toISOString() },
    }, resPropose);
    assert.strictEqual(resPropose.statusCode, 400);
    assert(resPropose.body.message.includes('already teacher_completed'));
  });

  console.log('\n--- 6. Idempotency & Zero Duplicate Mutations ---');

  await test('Repeated teacher completion returns HTTP 200 with zero duplicate history or outbox', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const exchange = await createAndActivateCycle(uA, uB, uC);
    const sessionDate = new Date(Date.now() + 48 * 3600 * 1000);
    await scheduleLeg(exchange._id, 0, uA._id, uB._id, sessionDate);

    // Call 1: Teacher completes
    const res1 = mockRes();
    await teacherCompleteLeg({ userId: uA._id.toString(), params: { id: exchange._id.toString(), legIndex: '0' } }, res1);
    assert.strictEqual(res1.statusCode, 200);

    // Call 2: Duplicate teacher completion
    const res2 = mockRes();
    await teacherCompleteLeg({ userId: uA._id.toString(), params: { id: exchange._id.toString(), legIndex: '0' } }, res2);
    assert.strictEqual(res2.statusCode, 200);
    assert(res2.body.message.includes('already marked completed'));

    // Check history count: exactly 1
    const refreshed = await CircularExchange.findById(exchange._id);
    assert.strictEqual(refreshed.legs[0].completionHistory.length, 1);

    // Check outbox events: exactly 1
    const outboxEvents = await OutboxEvent.find({
      aggregateId: exchange._id,
      recipient: uB._id,
      type: 'CIRCULAR_LEG_TEACHER_COMPLETED',
    });
    assert.strictEqual(outboxEvents.length, 1);
  });

  await test('Repeated learner confirmation returns HTTP 200 with zero duplicate history or outbox', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const exchange = await createAndActivateCycle(uA, uB, uC);
    const sessionDate = new Date(Date.now() + 48 * 3600 * 1000);
    await scheduleLeg(exchange._id, 0, uA._id, uB._id, sessionDate);

    // Teacher completes
    const resT = mockRes();
    await teacherCompleteLeg({ userId: uA._id.toString(), params: { id: exchange._id.toString(), legIndex: '0' } }, resT);
    assert.strictEqual(resT.statusCode, 200);

    // Learner confirms call 1
    const resL1 = mockRes();
    await learnerConfirmLegCompletion({ userId: uB._id.toString(), params: { id: exchange._id.toString(), legIndex: '0' } }, resL1);
    assert.strictEqual(resL1.statusCode, 200);

    // Learner confirms call 2 (duplicate)
    const resL2 = mockRes();
    await learnerConfirmLegCompletion({ userId: uB._id.toString(), params: { id: exchange._id.toString(), legIndex: '0' } }, resL2);
    assert.strictEqual(resL2.statusCode, 200);
    assert(resL2.body.message.includes('already confirmed'));

    // Verify history length: exactly 2 (teacher_completed, completed)
    const refreshed = await CircularExchange.findById(exchange._id);
    assert.strictEqual(refreshed.legs[0].completionHistory.length, 2);

    // Verify outbox count for teacher confirmation: exactly 1
    const outboxEvents = await OutboxEvent.find({
      aggregateId: exchange._id,
      recipient: uA._id,
      type: 'CIRCULAR_LEG_COMPLETED',
    });
    assert.strictEqual(outboxEvents.length, 1);
  });

  console.log('\n--- 7. Concurrent Completion Attempts ---');

  await test('Two simultaneous teacher complete requests both resolve safely without race corruption', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const exchange = await createAndActivateCycle(uA, uB, uC);
    const sessionDate = new Date(Date.now() + 48 * 3600 * 1000);
    await scheduleLeg(exchange._id, 0, uA._id, uB._id, sessionDate);

    const [res1, res2] = await Promise.all([
      (async () => {
        const r = mockRes();
        await teacherCompleteLeg({ userId: uA._id.toString(), params: { id: exchange._id.toString(), legIndex: '0' } }, r);
        return r;
      })(),
      (async () => {
        const r = mockRes();
        await teacherCompleteLeg({ userId: uA._id.toString(), params: { id: exchange._id.toString(), legIndex: '0' } }, r);
        return r;
      })(),
    ]);

    assert.strictEqual(res1.statusCode, 200);
    assert.strictEqual(res2.statusCode, 200);

    const refreshed = await CircularExchange.findById(exchange._id);
    assert.strictEqual(refreshed.legs[0].status, 'teacher_completed');
    assert.strictEqual(refreshed.legs[0].completionHistory.length, 1);
  });

  await test('Two simultaneous learner confirm requests both resolve safely without duplicate records', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const exchange = await createAndActivateCycle(uA, uB, uC);
    const sessionDate = new Date(Date.now() + 48 * 3600 * 1000);
    await scheduleLeg(exchange._id, 0, uA._id, uB._id, sessionDate);

    // Teacher completes
    const resT = mockRes();
    await teacherCompleteLeg({ userId: uA._id.toString(), params: { id: exchange._id.toString(), legIndex: '0' } }, resT);
    assert.strictEqual(resT.statusCode, 200);

    // Two simultaneous learner confirmations
    const [res1, res2] = await Promise.all([
      (async () => {
        const r = mockRes();
        await learnerConfirmLegCompletion({ userId: uB._id.toString(), params: { id: exchange._id.toString(), legIndex: '0' } }, r);
        return r;
      })(),
      (async () => {
        const r = mockRes();
        await learnerConfirmLegCompletion({ userId: uB._id.toString(), params: { id: exchange._id.toString(), legIndex: '0' } }, r);
        return r;
      })(),
    ]);

    assert.strictEqual(res1.statusCode, 200);
    assert.strictEqual(res2.statusCode, 200);

    const refreshed = await CircularExchange.findById(exchange._id);
    assert.strictEqual(refreshed.legs[0].status, 'completed');
    assert.strictEqual(refreshed.legs[0].completionHistory.length, 2);
  });

  console.log('\n--- 8. Reliability Attribution & Zero Double-Counting ---');

  await test('Reliability is attributed only to teacher and only upon learner confirmation', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    // Initial reliability for both
    const initialA = await getUserExchangeReliability(uA._id);
    const initialB = await getUserExchangeReliability(uB._id);
    assert.strictEqual(initialA.completedCount, 0);
    assert.strictEqual(initialA.score, 0.70);
    assert.strictEqual(initialB.completedCount, 0);
    assert.strictEqual(initialB.score, 0.70);

    const exchange = await createAndActivateCycle(uA, uB, uC);
    const sessionDate = new Date(Date.now() + 48 * 3600 * 1000);
    await scheduleLeg(exchange._id, 0, uA._id, uB._id, sessionDate);

    // Step 1: Teacher completes. (Unconfirmed!)
    const resT = mockRes();
    await teacherCompleteLeg({ userId: uA._id.toString(), params: { id: exchange._id.toString(), legIndex: '0' } }, resT);
    assert.strictEqual(resT.statusCode, 200);

    // Verify reliability after unconfirmed completion:
    // Neither teacher nor learner should have completedCount incremented yet!
    const midA = await getUserExchangeReliability(uA._id);
    const midB = await getUserExchangeReliability(uB._id);
    assert.strictEqual(midA.completedCount, 0, 'Unconfirmed leg must not credit completedCount to teacher');
    assert.strictEqual(midA.score, 0.70);
    assert.strictEqual(midB.completedCount, 0);

    // Step 2: Learner confirms completion
    const resL = mockRes();
    await learnerConfirmLegCompletion({ userId: uB._id.toString(), params: { id: exchange._id.toString(), legIndex: '0' } }, resL);
    assert.strictEqual(resL.statusCode, 200);

    // Verify reliability after learner confirmation:
    // Teacher uA: completedCount = 1! Bayesian score = (1 + 3 * 0.7) / (1 + 0 + 3) = 3.1 / 4 = 0.7750
    const finalA = await getUserExchangeReliability(uA._id);
    assert.strictEqual(finalA.completedCount, 1);
    assert.strictEqual(finalA.score, 0.775);

    // Learner uB: received teaching on leg 0. Under circular rules, learner is NOT credited for learning!
    const finalB = await getUserExchangeReliability(uB._id);
    assert.strictEqual(finalB.completedCount, 0);
    assert.strictEqual(finalB.score, 0.70);

    // Step 3: Duplicate learner confirmation -> check no double counting
    const resL_dup = mockRes();
    await learnerConfirmLegCompletion({ userId: uB._id.toString(), params: { id: exchange._id.toString(), legIndex: '0' } }, resL_dup);
    assert.strictEqual(resL_dup.statusCode, 200);

    const postDupA = await getUserExchangeReliability(uA._id);
    assert.strictEqual(postDupA.completedCount, 1, 'Duplicate confirmation must not double-count reliability');
    assert.strictEqual(postDupA.score, 0.775);
  });

  console.log('\n--- 9. Transaction Rollback & Standalone Compensation ---');

  await test('Outbox failure during teacher completion rolls back leg status', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const exchange = await createAndActivateCycle(uA, uB, uC);
    const sessionDate = new Date(Date.now() + 48 * 3600 * 1000);
    await scheduleLeg(exchange._id, 0, uA._id, uB._id, sessionDate);

    // Monkey-patch OutboxEvent.create to throw
    const originalCreate = OutboxEvent.create;
    OutboxEvent.create = async function () {
      throw new Error('Simulated Outbox Disk Failure');
    };

    try {
      const res = mockRes();
      await teacherCompleteLeg({ userId: uA._id.toString(), params: { id: exchange._id.toString(), legIndex: '0' } }, res);
      assert.strictEqual(res.statusCode, 500);

      // Verify rollback: leg status remains 'scheduled'
      const refreshed = await CircularExchange.findById(exchange._id);
      assert.strictEqual(refreshed.legs[0].status, 'scheduled');
      assert.strictEqual(refreshed.legs[0].completionHistory.length, 0);
    } finally {
      OutboxEvent.create = originalCreate;
    }
  });

  await test('Outbox failure during learner confirmation rolls back child swap and leg status', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const exchange = await createAndActivateCycle(uA, uB, uC);
    const sessionDate = new Date(Date.now() + 48 * 3600 * 1000);
    await scheduleLeg(exchange._id, 0, uA._id, uB._id, sessionDate);

    // Teacher completes successfully
    const resT = mockRes();
    await teacherCompleteLeg({ userId: uA._id.toString(), params: { id: exchange._id.toString(), legIndex: '0' } }, resT);
    assert.strictEqual(resT.statusCode, 200);

    // Monkey-patch OutboxEvent.create to throw
    const originalCreate = OutboxEvent.create;
    OutboxEvent.create = async function () {
      throw new Error('Simulated Outbox Failure during confirmation');
    };

    try {
      const resL = mockRes();
      await learnerConfirmLegCompletion({ userId: uB._id.toString(), params: { id: exchange._id.toString(), legIndex: '0' } }, resL);
      assert.strictEqual(resL.statusCode, 500);

      // Verify rollback: leg status remains 'teacher_completed', child swap remains 'accepted'
      const refreshed = await CircularExchange.findById(exchange._id);
      assert.strictEqual(refreshed.legs[0].status, 'teacher_completed');
      const childSwap = await SwapRequest.findById(refreshed.legs[0].swapRequest);
      assert.strictEqual(childSwap.status, 'accepted');
    } finally {
      OutboxEvent.create = originalCreate;
    }
  });

  console.log('\n--- 10. Bilateral Completion Regression ---');

  await test('Regression: Bilateral PUT /api/swap/:id/complete continues to function and release reservations', async () => {
    const u1 = await createTestUser();
    const u2 = await createTestUser();

    // Create bilateral swap with status accepted
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

    // Create bilateral reservations
    await ExchangeReservation.create([
      { participant: u1._id, exchangeType: 'bilateral', exchangeId: swap._id, skillBeingTaught: 'Cooking' },
      { participant: u2._id, exchangeType: 'bilateral', exchangeId: swap._id, skillBeingTaught: 'Baking' },
    ]);

    const req = {
      userId: u1._id.toString(),
      params: { id: swap._id.toString() },
    };
    const res = mockRes();
    await completeSwapRequest(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.status, 'completed');

    // Verify reservations released
    const activeRes = await ExchangeReservation.find({ exchangeId: swap._id, status: 'active' });
    assert.strictEqual(activeRes.length, 0);

    // Verify reliability attribution for bilateral: BOTH participants get completion credit!
    const rel1 = await getUserExchangeReliability(u1._id);
    const rel2 = await getUserExchangeReliability(u2._id);
    assert.strictEqual(rel1.completedCount, 1);
    assert.strictEqual(rel2.completedCount, 1);
  });

  console.log('\n--- 11. Independent Completion of All Three Circular Legs ---');

  await test('All three legs complete independently with distinct actors, timestamps, and child swap updates', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const exchange = await createAndActivateCycle(uA, uB, uC, ['Node.js', 'React', 'Python']);
    const cycleId = exchange._id.toString();

    // Schedule all 3 legs
    const d0 = new Date(Date.now() + 24 * 3600 * 1000);
    const d1 = new Date(Date.now() + 48 * 3600 * 1000);
    const d2 = new Date(Date.now() + 72 * 3600 * 1000);
    await scheduleLeg(cycleId, 0, uA._id, uB._id, d0);
    await scheduleLeg(cycleId, 1, uB._id, uC._id, d1);
    await scheduleLeg(cycleId, 2, uC._id, uA._id, d2);

    // Complete Leg 0: A teaches B
    const resT0 = mockRes();
    await teacherCompleteLeg({ userId: uA._id.toString(), params: { id: cycleId, legIndex: '0' } }, resT0);
    assert.strictEqual(resT0.statusCode, 200);

    const resL0 = mockRes();
    await learnerConfirmLegCompletion({ userId: uB._id.toString(), params: { id: cycleId, legIndex: '0' } }, resL0);
    assert.strictEqual(resL0.statusCode, 200);

    // Verify: Leg 0 is completed, but Leg 1 and Leg 2 are still scheduled!
    let current = await CircularExchange.findById(cycleId);
    assert.strictEqual(current.legs[0].status, 'completed');
    assert.strictEqual(current.legs[1].status, 'scheduled');
    assert.strictEqual(current.legs[2].status, 'scheduled');

    // Complete Leg 1: B teaches C
    const resT1 = mockRes();
    await teacherCompleteLeg({ userId: uB._id.toString(), params: { id: cycleId, legIndex: '1' } }, resT1);
    assert.strictEqual(resT1.statusCode, 200);

    const resL1 = mockRes();
    await learnerConfirmLegCompletion({ userId: uC._id.toString(), params: { id: cycleId, legIndex: '1' } }, resL1);
    assert.strictEqual(resL1.statusCode, 200);

    // Verify: Leg 0 and Leg 1 are completed, Leg 2 is still scheduled
    current = await CircularExchange.findById(cycleId);
    assert.strictEqual(current.legs[0].status, 'completed');
    assert.strictEqual(current.legs[1].status, 'completed');
    assert.strictEqual(current.legs[2].status, 'scheduled');

    // Complete Leg 2: C teaches A
    const resT2 = mockRes();
    await teacherCompleteLeg({ userId: uC._id.toString(), params: { id: cycleId, legIndex: '2' } }, resT2);
    assert.strictEqual(resT2.statusCode, 200);

    const resL2 = mockRes();
    await learnerConfirmLegCompletion({ userId: uA._id.toString(), params: { id: cycleId, legIndex: '2' } }, resL2);
    assert.strictEqual(resL2.statusCode, 200, resL2.body?.error || resL2.body?.message);

    // All three legs are now completed!
    current = await CircularExchange.findById(cycleId);
    assert.strictEqual(current.legs[0].status, 'completed');
    assert.strictEqual(current.legs[1].status, 'completed');
    assert.strictEqual(current.legs[2].status, 'completed');

    // Substage 3.4.3: Parent exchange is automatically finalized when all 3 legs are completed
    assert.strictEqual(current.status, 'completed');
    assert.ok(current.completedAt);
    assert.strictEqual(current.finalizationHistory.length, 1);

    // All 3 child swaps are synchronized to completed
    const cs0 = await SwapRequest.findById(current.legs[0].swapRequest);
    const cs1 = await SwapRequest.findById(current.legs[1].swapRequest);
    const cs2 = await SwapRequest.findById(current.legs[2].swapRequest);
    assert.strictEqual(cs0.status, 'completed');
    assert.strictEqual(cs1.status, 'completed');
    assert.strictEqual(cs2.status, 'completed');

    // Reliability attribution: each participant was the teacher of exactly one leg!
    // Each participant's completedCount should be exactly 1!
    const relA = await getUserExchangeReliability(uA._id);
    const relB = await getUserExchangeReliability(uB._id);
    const relC = await getUserExchangeReliability(uC._id);
    assert.strictEqual(relA.completedCount, 1);
    assert.strictEqual(relB.completedCount, 1);
    assert.strictEqual(relC.completedCount, 1);
    assert.strictEqual(relA.score, 0.775);
    assert.strictEqual(relB.score, 0.775);
    assert.strictEqual(relC.score, 0.775);
  });

  console.log('\n--- 12. End-to-End HTTP Server Routing & JWT Auth ---');

  await test('End-to-End HTTP: Teacher completes and Learner confirms via HTTP endpoints', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const exchange = await createAndActivateCycle(uA, uB, uC);
    const cycleId = exchange._id.toString();
    const sessionDate = new Date(Date.now() + 48 * 3600 * 1000);
    await scheduleLeg(cycleId, 0, uA._id, uB._id, sessionDate);

    const tokenA = generateToken(uA._id);
    const tokenB = generateToken(uB._id);

    // 1. Teacher uA marks leg 0 complete via HTTP PUT
    const httpTRes = await fetch(`${testBaseUrl}/${cycleId}/legs/0/complete`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({ notes: 'HTTP teacher completion' }),
    });
    assert.strictEqual(httpTRes.status, 200);
    const httpTData = await httpTRes.json();
    assert.strictEqual(httpTData.status, 'teacher_completed');
    assert.ok(httpTData.teacherCompletedAt);

    // 2. Schedule overview shows canLearnerConfirmCompletion = true for Learner uB
    const scheduleRes = await fetch(`${testBaseUrl}/${cycleId}/schedule`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    assert.strictEqual(scheduleRes.status, 200);
    const schedData = await scheduleRes.json();
    assert.strictEqual(schedData.legs[0].status, 'teacher_completed');
    assert.strictEqual(schedData.legs[0].canLearnerConfirmCompletion, true);

    // 3. Learner uB confirms completion via HTTP PUT
    const httpLRes = await fetch(`${testBaseUrl}/${cycleId}/legs/0/complete/confirm`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenB}`,
      },
      body: JSON.stringify({ notes: 'HTTP learner confirmation' }),
    });
    assert.strictEqual(httpLRes.status, 200);
    const httpLData = await httpLRes.json();
    assert.strictEqual(httpLData.status, 'completed');
    assert.ok(httpLData.learnerConfirmedAt);
    assert.ok(httpLData.completedAt);
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
  console.log(`Substage 3.4.2 Test Results: ${passed} passed, ${failed} failed`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
