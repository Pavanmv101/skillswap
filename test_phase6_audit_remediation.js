/**
 * Phase 6 — Advanced Skill Exchange Algorithm
 * test_phase6_audit_remediation.js
 *
 * Dedicated regression tests for Phase 6 Integration Audit Remediation:
 * - F-01: Circular reservation release on parent finalization, rollback safety, and re-participation.
 * - F-02: Protection of circular child swaps against bilateral mutation endpoints.
 * - Non-regression of normal bilateral swap and circular workflows.
 */

'use strict';

require('dotenv').config();
const assert = require('assert');
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
} = require('./controllers/circularSchedulingController');

const {
  acceptSwapRequest,
  rejectSwapRequest,
  cancelSwapRequest,
  completeSwapRequest,
  scheduleSwap,
} = require('./controllers/swapController');

const {
  acquireReservations,
  releaseReservations,
  isTransactionSupported,
} = require('./services/reservationService');

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

async function createTestUser(data = {}) {
  const suffix = Math.random().toString(36).substring(2, 9);
  const u = new User({
    name: data.name || `User_${suffix}`,
    email: data.email || `user_${suffix}@test.com`,
    password: data.password || 'hashed_pw_test',
    skillsOffered: data.skillsOffered || [{ skill: 'Skill_' + suffix, level: 'Intermediate' }],
    skillsWanted: data.skillsWanted || [{ skill: 'Wanted_' + suffix, level: 'Intermediate' }],
    availabilitySlots: data.availabilitySlots || [],
    timezone: data.timezone || 'UTC',
  });
  await u.save();
  return u;
}

/**
 * Creates and activates a canonical 3-way circular exchange with ExchangeReservation records.
 */
async function setupActiveCycleWithReservations(uA, uB, uC, skills = ['Node.js', 'React', 'Python']) {
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

  // Create child SwapRequests
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

  // Acquire ExchangeReservation records for all 3 participants
  await ExchangeReservation.create([
    { participant: uA._id, exchangeType: 'circular', exchangeId: exchange._id, skillBeingTaught: skills[0] },
    { participant: uB._id, exchangeType: 'circular', exchangeId: exchange._id, skillBeingTaught: skills[1] },
    { participant: uC._id, exchangeType: 'circular', exchangeId: exchange._id, skillBeingTaught: skills[2] },
  ]);

  return exchange;
}

async function scheduleLeg(exchangeId, legIndex, teacherId, learnerId, futureDate) {
  const reqPro = {
    userId: teacherId.toString(),
    params: { id: exchangeId.toString(), legIndex: String(legIndex) },
    body: { scheduledTime: futureDate.toISOString() },
  };
  const resPro = mockRes();
  await proposeLegSchedule(reqPro, resPro);
  assert.strictEqual(resPro.statusCode, 200, resPro.body?.message);

  const proposalId = resPro.body.proposalId;
  const reqConf = {
    userId: learnerId.toString(),
    params: { id: exchangeId.toString(), legIndex: String(legIndex) },
    body: { proposalId },
  };
  const resConf = mockRes();
  await confirmLegSchedule(reqConf, resConf);
  assert.strictEqual(resConf.statusCode, 200, resConf.body?.message);
}

async function completeLeg(exchangeId, legIndex, teacherId, learnerId) {
  const reqTeach = {
    userId: teacherId.toString(),
    params: { id: exchangeId.toString(), legIndex: String(legIndex) },
    body: { notes: 'Teacher done' },
  };
  const resTeach = mockRes();
  await teacherCompleteLeg(reqTeach, resTeach);
  assert.strictEqual(resTeach.statusCode, 200, resTeach.body?.message);

  const reqLearn = {
    userId: learnerId.toString(),
    params: { id: exchangeId.toString(), legIndex: String(legIndex) },
    body: { notes: 'Learner confirmed' },
  };
  const resLearn = mockRes();
  await learnerConfirmLegCompletion(reqLearn, resLearn);
  assert.strictEqual(resLearn.statusCode, 200, resLearn.body?.message);
  return resLearn.body;
}

async function runTests() {
  console.log('================================================================');
  console.log(' Phase 6 Integration Audit Remediation Test Suite (F-01 & F-02)');
  console.log('================================================================\n');

  const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/skillswap';
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(mongoUri);
  }

  await CircularExchange.syncIndexes();
  await ExchangeReservation.syncIndexes();
  await SwapRequest.syncIndexes();
  await OutboxEvent.syncIndexes();

  // Clean slate for test run
  await CircularExchange.deleteMany({ initiator: { $exists: true } });
  await SwapRequest.deleteMany({});
  await ExchangeReservation.deleteMany({});
  await OutboxEvent.deleteMany({});
  await User.deleteMany({ email: /@test\.com$/ });

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. F-01: RESERVATION LIFECYCLE DURING CIRCULAR COMPLETION
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('--- 1. F-01: Reservation Lifecycle During Circular Completion ---');

  await test('Reservations remain active when only Leg 0 is completed', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const ex = await setupActiveCycleWithReservations(uA, uB, uC);
    const futureDate = new Date(Date.now() + 24 * 3600 * 1000);

    await scheduleLeg(ex._id, 0, uA._id, uB._id, futureDate);
    const body = await completeLeg(ex._id, 0, uA._id, uB._id);

    assert.strictEqual(body.exchangeFinalized, false);
    assert.strictEqual(body.exchangeStatus, 'active');

    // All 3 reservations must remain active
    const resCount = await ExchangeReservation.countDocuments({ exchangeId: ex._id, status: 'active' });
    assert.strictEqual(resCount, 3, 'All 3 reservations must remain active after completing 1 leg');
  });

  await test('Reservations remain active when Legs 0 and 1 are completed', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const ex = await setupActiveCycleWithReservations(uA, uB, uC);
    const futureDate = new Date(Date.now() + 24 * 3600 * 1000);

    // Complete Leg 0
    await scheduleLeg(ex._id, 0, uA._id, uB._id, futureDate);
    await completeLeg(ex._id, 0, uA._id, uB._id);

    // Complete Leg 1
    await scheduleLeg(ex._id, 1, uB._id, uC._id, futureDate);
    const body1 = await completeLeg(ex._id, 1, uB._id, uC._id);

    assert.strictEqual(body1.exchangeFinalized, false);
    assert.strictEqual(body1.exchangeStatus, 'active');

    // All 3 reservations must remain active
    const resCount = await ExchangeReservation.countDocuments({ exchangeId: ex._id, status: 'active' });
    assert.strictEqual(resCount, 3, 'All 3 reservations must remain active after completing 2 legs');
  });

  await test('All three reservations are atomically released upon third leg completion and finalization', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const ex = await setupActiveCycleWithReservations(uA, uB, uC);
    const futureDate = new Date(Date.now() + 24 * 3600 * 1000);

    // Complete Leg 0
    await scheduleLeg(ex._id, 0, uA._id, uB._id, futureDate);
    await completeLeg(ex._id, 0, uA._id, uB._id);

    // Complete Leg 1
    await scheduleLeg(ex._id, 1, uB._id, uC._id, futureDate);
    await completeLeg(ex._id, 1, uB._id, uC._id);

    // Complete Leg 2 -> Triggers finalization
    await scheduleLeg(ex._id, 2, uC._id, uA._id, futureDate);
    const body2 = await completeLeg(ex._id, 2, uC._id, uA._id);

    assert.strictEqual(body2.exchangeFinalized, true);
    assert.strictEqual(body2.exchangeStatus, 'completed');

    // ALL 3 reservations must be completely released
    const resCount = await ExchangeReservation.countDocuments({ exchangeId: ex._id });
    assert.strictEqual(resCount, 0, 'Reservations must be 0 after successful circular finalization');
  });

  await test('Participants can immediately acquire new bilateral reservations after circular finalization', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();
    const uD = await createTestUser();

    const ex = await setupActiveCycleWithReservations(uA, uB, uC);
    const futureDate = new Date(Date.now() + 24 * 3600 * 1000);

    // Complete all 3 legs
    await scheduleLeg(ex._id, 0, uA._id, uB._id, futureDate);
    await completeLeg(ex._id, 0, uA._id, uB._id);
    await scheduleLeg(ex._id, 1, uB._id, uC._id, futureDate);
    await completeLeg(ex._id, 1, uB._id, uC._id);
    await scheduleLeg(ex._id, 2, uC._id, uA._id, futureDate);
    await completeLeg(ex._id, 2, uC._id, uA._id);

    // Now User A and User D enter a bilateral swap
    const bilateralSwap = new SwapRequest({
      fromUser: uA._id,
      toUser: uD._id,
      offeredSkill: 'Guitar',
      wantedSkill: 'Piano',
      status: 'pending',
    });
    await bilateralSwap.save();

    // User D accepts the swap -> must acquire bilateral reservations without conflict!
    const reqAccept = {
      userId: uD._id.toString(),
      params: { id: bilateralSwap._id.toString() },
    };
    const resAccept = mockRes();
    await acceptSwapRequest(reqAccept, resAccept);

    assert.strictEqual(resAccept.statusCode, 200, resAccept.body?.message);
    assert.strictEqual(resAccept.body?.status, 'accepted');

    // Bilateral reservations exist for uA and uD
    const uARes = await ExchangeReservation.findOne({ participant: uA._id, exchangeType: 'bilateral' });
    const uDRes = await ExchangeReservation.findOne({ participant: uD._id, exchangeType: 'bilateral' });
    assert.ok(uARes, 'User A must successfully hold a new bilateral reservation');
    assert.ok(uDRes, 'User D must successfully hold a new bilateral reservation');
  });

  await test('Participants can subsequently join and activate another circular exchange', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    // First cycle
    const ex1 = await setupActiveCycleWithReservations(uA, uB, uC);
    const futureDate = new Date(Date.now() + 24 * 3600 * 1000);

    await scheduleLeg(ex1._id, 0, uA._id, uB._id, futureDate);
    await completeLeg(ex1._id, 0, uA._id, uB._id);
    await scheduleLeg(ex1._id, 1, uB._id, uC._id, futureDate);
    await completeLeg(ex1._id, 1, uB._id, uC._id);
    await scheduleLeg(ex1._id, 2, uC._id, uA._id, futureDate);
    await completeLeg(ex1._id, 2, uC._id, uA._id);

    const resCount1 = await ExchangeReservation.countDocuments({ exchangeId: ex1._id });
    assert.strictEqual(resCount1, 0);

    // Second cycle with same users A, B, C but different skills
    const ex2 = await setupActiveCycleWithReservations(uA, uB, uC, ['Cooking', 'Baking', 'Gardening']);
    const resCount2 = await ExchangeReservation.countDocuments({ exchangeId: ex2._id });
    assert.strictEqual(resCount2, 3, 'Users must be able to acquire circular reservations for a subsequent cycle');
  });

  await test('Rollback on outbox failure restores parent to active and does not release reservations', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const ex = await setupActiveCycleWithReservations(uA, uB, uC);
    const futureDate = new Date(Date.now() + 24 * 3600 * 1000);

    // Complete Legs 0 and 1
    await scheduleLeg(ex._id, 0, uA._id, uB._id, futureDate);
    await completeLeg(ex._id, 0, uA._id, uB._id);
    await scheduleLeg(ex._id, 1, uB._id, uC._id, futureDate);
    await completeLeg(ex._id, 1, uB._id, uC._id);

    // Schedule and teacher complete Leg 2
    await scheduleLeg(ex._id, 2, uC._id, uA._id, futureDate);
    const reqTeach2 = {
      userId: uC._id.toString(),
      params: { id: ex._id.toString(), legIndex: '2' },
      body: { notes: 'Teacher 2 done' },
    };
    const resTeach2 = mockRes();
    await teacherCompleteLeg(reqTeach2, resTeach2);
    assert.strictEqual(resTeach2.statusCode, 200);

    // Monkey-patch OutboxEvent.insertMany to simulate failure during finalization outbox write
    const originalInsertMany = OutboxEvent.insertMany;
    OutboxEvent.insertMany = async function () {
      throw new Error('Simulated Outbox Failure during Finalization');
    };

    try {
      const reqConf2 = {
        userId: uA._id.toString(),
        params: { id: ex._id.toString(), legIndex: '2' },
        body: { notes: 'Learner confirmed' },
      };
      const resConf2 = mockRes();
      await learnerConfirmLegCompletion(reqConf2, resConf2);
      assert.strictEqual(resConf2.statusCode, 500);
    } finally {
      OutboxEvent.insertMany = originalInsertMany;
    }

    // Verify parent is still 'active'
    const parentAfter = await CircularExchange.findById(ex._id);
    assert.strictEqual(parentAfter.status, 'active', 'Parent must remain active on finalization failure');

    // Verify reservations remain active (NOT released)
    const resCount = await ExchangeReservation.countDocuments({ exchangeId: ex._id, status: 'active' });
    assert.strictEqual(resCount, 3, 'All 3 reservations must remain active if finalization transaction fails');
  });

  await test('Duplicate final confirmations return 200 idempotently without re-releasing reservations', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const ex = await setupActiveCycleWithReservations(uA, uB, uC);
    const futureDate = new Date(Date.now() + 24 * 3600 * 1000);

    await scheduleLeg(ex._id, 0, uA._id, uB._id, futureDate);
    await completeLeg(ex._id, 0, uA._id, uB._id);
    await scheduleLeg(ex._id, 1, uB._id, uC._id, futureDate);
    await completeLeg(ex._id, 1, uB._id, uC._id);
    await scheduleLeg(ex._id, 2, uC._id, uA._id, futureDate);
    await completeLeg(ex._id, 2, uC._id, uA._id);

    // Attempt second confirmation on Leg 2
    const reqConfRepeat = {
      userId: uA._id.toString(),
      params: { id: ex._id.toString(), legIndex: '2' },
      body: { notes: 'Learner confirm repeat' },
    };
    const resConfRepeat = mockRes();
    await learnerConfirmLegCompletion(reqConfRepeat, resConfRepeat);

    assert.strictEqual(resConfRepeat.statusCode, 200);
    assert.strictEqual(resConfRepeat.body.exchangeFinalized, true);

    const resCount = await ExchangeReservation.countDocuments({ exchangeId: ex._id });
    assert.strictEqual(resCount, 0, 'Reservations count must remain 0 on idempotent duplicate confirmation');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. F-02: PROTECT CIRCULAR CHILD SWAPS FROM BILATERAL ENDPOINTS
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- 2. F-02: Protect Circular Child Swaps from Bilateral Endpoints ---');

  await test('Bilateral cancelSwapRequest rejects circular child swap with HTTP 409', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const ex = await setupActiveCycleWithReservations(uA, uB, uC);
    const childSwapId = ex.legs[0].swapRequest;

    const req = {
      userId: uA._id.toString(), // Leg 0 fromUser
      params: { id: childSwapId.toString() },
      body: { reason: 'Accidental cancel' },
    };
    const res = mockRes();
    await cancelSwapRequest(req, res);

    assert.strictEqual(res.statusCode, 409, `Expected 409, got ${res.statusCode}`);
    assert(res.body.message.includes('Circular exchange legs cannot be modified directly via bilateral endpoints'));

    // Child swap must remain 'accepted'
    const swapDoc = await SwapRequest.findById(childSwapId);
    assert.strictEqual(swapDoc.status, 'accepted');
  });

  await test('Bilateral completeSwapRequest rejects circular child swap with HTTP 409', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const ex = await setupActiveCycleWithReservations(uA, uB, uC);
    const childSwapId = ex.legs[0].swapRequest;

    const req = {
      userId: uA._id.toString(),
      params: { id: childSwapId.toString() },
    };
    const res = mockRes();
    await completeSwapRequest(req, res);

    assert.strictEqual(res.statusCode, 409, `Expected 409, got ${res.statusCode}`);
    assert(res.body.message.includes('Circular exchange legs cannot be modified directly via bilateral endpoints'));

    // Child swap must remain 'accepted'
    const swapDoc = await SwapRequest.findById(childSwapId);
    assert.strictEqual(swapDoc.status, 'accepted');
  });

  await test('Bilateral scheduleSwap rejects circular child swap with HTTP 409', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const ex = await setupActiveCycleWithReservations(uA, uB, uC);
    const childSwapId = ex.legs[0].swapRequest;

    const req = {
      userId: uA._id.toString(),
      params: { id: childSwapId.toString() },
      body: { scheduledAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString() },
    };
    const res = mockRes();
    await scheduleSwap(req, res);

    assert.strictEqual(res.statusCode, 409, `Expected 409, got ${res.statusCode}`);
    assert(res.body.message.includes('Circular exchange legs cannot be modified directly via bilateral endpoints'));

    // Child swap scheduledAt must remain null
    const swapDoc = await SwapRequest.findById(childSwapId);
    assert.strictEqual(swapDoc.scheduledAt, undefined);
  });

  await test('Bilateral acceptSwapRequest rejects circular child swap with HTTP 409', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const ex = await setupActiveCycleWithReservations(uA, uB, uC);
    const childSwapId = ex.legs[0].swapRequest;

    const req = {
      userId: uB._id.toString(), // Leg 0 toUser
      params: { id: childSwapId.toString() },
    };
    const res = mockRes();
    await acceptSwapRequest(req, res);

    assert.strictEqual(res.statusCode, 409, `Expected 409, got ${res.statusCode}`);
    assert(res.body.message.includes('Circular exchange legs cannot be modified directly via bilateral endpoints'));
  });

  await test('Bilateral rejectSwapRequest rejects circular child swap with HTTP 409', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const ex = await setupActiveCycleWithReservations(uA, uB, uC);
    const childSwapId = ex.legs[0].swapRequest;

    const req = {
      userId: uB._id.toString(), // Leg 0 toUser
      params: { id: childSwapId.toString() },
    };
    const res = mockRes();
    await rejectSwapRequest(req, res);

    assert.strictEqual(res.statusCode, 409, `Expected 409, got ${res.statusCode}`);
    assert(res.body.message.includes('Circular exchange legs cannot be modified directly via bilateral endpoints'));
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. NON-REGRESSION: NORMAL BILATERAL AND CIRCULAR OPERATIONS
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- 3. Non-Regression: Bilateral and Circular Functionality ---');

  await test('Normal bilateral swap: accept, schedule, complete lifecycle works unaffected', async () => {
    const u1 = await createTestUser();
    const u2 = await createTestUser();

    const swap = new SwapRequest({
      fromUser: u1._id,
      toUser: u2._id,
      offeredSkill: 'Python',
      wantedSkill: 'JavaScript',
      status: 'pending',
    });
    await swap.save();

    // 1. Accept
    const resAcc = mockRes();
    await acceptSwapRequest({ userId: u2._id.toString(), params: { id: swap._id.toString() } }, resAcc);
    assert.strictEqual(resAcc.statusCode, 200);
    assert.strictEqual(resAcc.body.status, 'accepted');

    // 2. Schedule
    const resSched = mockRes();
    const schedDate = new Date(Date.now() + 48 * 3600 * 1000);
    await scheduleSwap(
      { userId: u1._id.toString(), params: { id: swap._id.toString() }, body: { scheduledAt: schedDate.toISOString() } },
      resSched
    );
    assert.strictEqual(resSched.statusCode, 200);

    // 3. Complete
    const resComp = mockRes();
    await completeSwapRequest({ userId: u2._id.toString(), params: { id: swap._id.toString() } }, resComp);
    assert.strictEqual(resComp.statusCode, 200);
    assert.strictEqual(resComp.body.status, 'completed');

    // Bilateral reservations released
    const resCount = await ExchangeReservation.countDocuments({ exchangeId: swap._id });
    assert.strictEqual(resCount, 0, 'Bilateral completion must release bilateral reservations');
  });

  await test('Normal bilateral swap: cancel works unaffected', async () => {
    const u1 = await createTestUser();
    const u2 = await createTestUser();

    const swap = new SwapRequest({
      fromUser: u1._id,
      toUser: u2._id,
      offeredSkill: 'Cooking',
      wantedSkill: 'Baking',
      status: 'pending',
    });
    await swap.save();

    const resCan = mockRes();
    await cancelSwapRequest(
      { userId: u1._id.toString(), params: { id: swap._id.toString() }, body: { reason: 'No longer available' } },
      resCan
    );
    assert.strictEqual(resCan.statusCode, 200);
    assert.strictEqual(resCan.body.status, 'cancelled');
  });

  await test('Dedicated circular scheduling and completion endpoints continue working normally', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const ex = await setupActiveCycleWithReservations(uA, uB, uC);
    const futureDate = new Date(Date.now() + 24 * 3600 * 1000);

    // Dedicated circular scheduling on Leg 0
    await scheduleLeg(ex._id, 0, uA._id, uB._id, futureDate);

    const exAfterSched = await CircularExchange.findById(ex._id);
    assert.strictEqual(exAfterSched.legs[0].status, 'scheduled');
    assert.ok(exAfterSched.legs[0].scheduledAt);

    // Dedicated circular completion on Leg 0
    const body = await completeLeg(ex._id, 0, uA._id, uB._id);
    assert.strictEqual(body.status, 'completed');

    const exAfterComp = await CircularExchange.findById(ex._id);
    assert.strictEqual(exAfterComp.legs[0].status, 'completed');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // CLEANUP
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- Teardown Test Data ---');
  await CircularExchange.deleteMany({ initiator: { $exists: true } });
  await SwapRequest.deleteMany({});
  await ExchangeReservation.deleteMany({});
  await OutboxEvent.deleteMany({});
  await User.deleteMany({ email: /@test\.com$/ });
  await mongoose.disconnect();
  console.log('  🧹 Teardown complete.');

  console.log('\n================================================================');
  console.log(` Audit Remediation Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
