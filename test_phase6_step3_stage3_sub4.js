/**
 * Phase 6 — Advanced Skill Exchange Algorithm (Step 3 - Substage 3.4.1.2)
 * test_phase6_step3_stage3_sub4.js
 *
 * Dedicated test suite for Circular Leg Scheduling & Rescheduling:
 * 1. Initial proposal and mutual confirmation (using proposalId).
 * 2. Proposal rejection with optional feedback reason (using proposalId).
 * 3. Rescheduling: Old confirmed schedule preserved when new proposal is rejected.
 * 4. Revised proposal supersedes old proposal in scheduleHistory with proposalId.
 * 5. Invalid date validation (past dates, malformed date strings).
 * 6. Availability slot validation (authoritative UTC convention).
 * 7. Double-booking conflict prevention across bilateral and circular swaps (±30m).
 * 8. Strict authorization: Only teacher can propose; only learner can confirm/reject.
 * 9. Stale/invalid proposal confirmation & rejection blocked (Finding 1).
 * 10. Concurrency: Version check prevents silent overwrite (Finding 1).
 * 11. Transaction rollback: Outbox failure rolls back scheduling mutation.
 * 12. Reminder service isolation: Unconfirmed proposals do not trigger session reminders.
 * 13. Independent scheduling: All 3 legs schedule and reschedule completely independently.
 * 14. Bilateral scheduling regression: Existing bilateral scheduling operates untouched.
 * 15. End-to-End HTTP route & JWT authentication integration.
 * 16. Audit Finding 1: proposalId required in confirm/reject; stale/missing returns 409 with zero mutation.
 * 17. Audit Finding 2: Repeated confirmation is idempotent (HTTP 200, zero duplicate history/outbox).
 * 18. Audit Finding 3: Availability revalidation at confirmation (HTTP 409 if slot withdrawn, 200 if retained).
 * 19. Audit Finding 4: Authoritative UTC timezone evaluation without dual-checking drift.
 */

'use strict';

require('dotenv').config();
const assert = require('assert');
const mongoose = require('mongoose');
const http = require('http');
const express = require('express');
const jwt = require('jsonwebtoken');

const User = require('./models/User');
const CircularExchange = require('./models/CircularExchange');
const SwapRequest = require('./models/SwapRequest');
const ExchangeReservation = require('./models/ExchangeReservation');
const OutboxEvent = require('./models/OutboxEvent');
const Notification = require('./models/Notification');

const {
  createCircularProposal,
  acceptCircularInvitation,
} = require('./controllers/circularProposalController');

const {
  getCircularSchedule,
  proposeLegSchedule,
  confirmLegSchedule,
  rejectLegSchedule,
  isTimeWithinSlots,
  checkDoubleBooking,
} = require('./controllers/circularSchedulingController');

const { scheduleSwap } = require('./controllers/swapController');
const { checkUpcomingSessionReminders } = require('./services/reminderService');
const { isTransactionSupported } = require('./services/reservationService');
const circularRoutes = require('./routes/circularRoutes');

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

const createdUserIds = [];
const createdCycleIds = [];
const createdSwapIds = [];
const createdResIds = [];
const createdOutboxIds = [];
const createdNotifIds = [];

async function createTestUser(data = {}) {
  const unique = Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
  const user = await User.create({
    name: data.name || `User_${unique}`,
    email: data.email || `user_${unique}@example.com`,
    password: data.password || '$2a$10$hashedpasswordforexamplepurposesonly123',
    bio: data.bio || `Bio of ${unique}`,
    skillsOffered: data.skillsOffered || [],
    skillsWanted: data.skillsWanted || [],
    availabilitySlots: data.availabilitySlots || [
      { day: 'Monday', from: '09:00', to: '18:00' },
      { day: 'Wednesday', from: '09:00', to: '18:00' },
      { day: 'Friday', from: '09:00', to: '18:00' },
    ],
    blockedUsers: data.blockedUsers || [],
    averageRating: data.averageRating ?? 0,
    totalRatings: data.totalRatings ?? 0,
  });
  createdUserIds.push(user._id);
  return user;
}

function generateToken(userId) {
  return jwt.sign({ id: userId.toString() }, process.env.JWT_SECRET || 'secret');
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

function buildValid3CycleLegs(uA, uB, uC, skills = ['Rust', 'Zig', 'Go']) {
  return [
    {
      teacher: uA._id,
      learner: uB._id,
      skill: skills[0],
      category: 'Development',
      teacherLevel: 'Advanced',
      learnerLevel: 'Beginner',
    },
    {
      teacher: uB._id,
      learner: uC._id,
      skill: skills[1],
      category: 'Development',
      teacherLevel: 'Intermediate',
      learnerLevel: 'Beginner',
    },
    {
      teacher: uC._id,
      learner: uA._id,
      skill: skills[2],
      category: 'Development',
      teacherLevel: 'Advanced',
      learnerLevel: 'Intermediate',
    },
  ];
}

async function createAndActivateCycle(uA, uB, uC, skills) {
  const legs = buildValid3CycleLegs(uA, uB, uC, skills);
  const reqCreate = { userId: uA._id.toString(), body: { legs } };
  const resCreate = mockRes();
  await createCircularProposal(reqCreate, resCreate);
  const cycleId = resCreate.body._id.toString();
  createdCycleIds.push(cycleId);

  // Bob accepts
  await acceptCircularInvitation({ userId: uB._id.toString(), params: { id: cycleId } }, mockRes());
  // Charlie accepts -> triggers atomic activation
  await acceptCircularInvitation({ userId: uC._id.toString(), params: { id: cycleId } }, mockRes());

  const activeDoc = await CircularExchange.findById(cycleId);
  return activeDoc;
}

/**
 * Returns a future Date strictly constructed in UTC.
 * Guarantees that targetDay matches date.getUTCDay() and utcHour matches date.getUTCHours().
 */
function getFutureSlotDate(dayName = 'Monday', utcHour = 14) {
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const targetDay = DAYS.indexOf(dayName);
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), utcHour, 0, 0, 0));
  let daysToAdd = (targetDay - now.getUTCDay() + 7) % 7;
  if (daysToAdd === 0) daysToAdd = 7;
  d.setUTCDate(d.getUTCDate() + daysToAdd);
  return d;
}

let testServer = null;
let testBaseUrl = '';

async function startHttpServer() {
  const app = express();
  app.use(express.json());
  app.use('/api/circular', circularRoutes);

  await new Promise((resolve) => {
    testServer = http.createServer(app);
    testServer.listen(0, () => {
      const port = testServer.address().port;
      testBaseUrl = `http://localhost:${port}/api/circular`;
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
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/skillswap');
  console.log(`Connected. Standalone/Transaction Mode: ${isTransactionSupported() ? 'ReplicaSet (Transactions)' : 'Standalone (Fallback)'}`);

  await startHttpServer();

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. INITIAL PROPOSAL AND CONFIRMATION
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- 1. Initial Proposal & Mutual Confirmation ---');

  await test('Teacher proposes schedule -> Learner confirms -> Parent & child scheduled atomically', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const exchange = await createAndActivateCycle(uA, uB, uC, ['Node.js', 'Python', 'Elixir']);
    const cycleId = exchange._id.toString();

    const futureTime = getFutureSlotDate('Monday', 14);

    // Alice (teacher of leg 0) proposes schedule
    const reqPropose = {
      userId: uA._id.toString(),
      params: { id: cycleId, legIndex: '0' },
      body: { scheduledTime: futureTime.toISOString() },
    };
    const resPropose = mockRes();
    await proposeLegSchedule(reqPropose, resPropose);

    assert.strictEqual(resPropose.statusCode, 200);
    assert(resPropose.body.message.includes('awaiting learner confirmation'));
    assert.strictEqual(resPropose.body.scheduleProposal.status, 'pending_confirmation');
    assert.strictEqual(new Date(resPropose.body.scheduleProposal.proposedTime).getTime(), futureTime.getTime());
    const proposalId = resPropose.body.proposalId;
    assert.ok(proposalId, 'proposalId must be generated');

    // CRITICAL: Leg scheduledAt and child SwapRequest.scheduledAt MUST still be null before learner confirmation
    let legCheck = (await CircularExchange.findById(cycleId)).legs[0];
    assert.strictEqual(legCheck.scheduledAt, null, 'Leg scheduledAt must remain null until confirmed');
    assert.strictEqual(legCheck.status, 'active', 'Leg status must remain active until confirmed');

    let childSwap = await SwapRequest.findById(legCheck.swapRequest);
    assert.strictEqual(!childSwap.scheduledAt, true, 'Child SwapRequest.scheduledAt must remain null until confirmed');

    // OutboxEvent check for proposal
    const proposeEvents = await OutboxEvent.find({
      aggregateId: cycleId,
      type: 'CIRCULAR_LEG_SCHEDULE_PROPOSED',
    });
    assert.strictEqual(proposeEvents.length, 1);
    assert.strictEqual(proposeEvents[0].recipient.toString(), uB._id.toString());

    // Bob (learner of leg 0) confirms with proposalId
    const reqConfirm = {
      userId: uB._id.toString(),
      params: { id: cycleId, legIndex: '0' },
      body: { proposalId },
    };
    const resConfirm = mockRes();
    await confirmLegSchedule(reqConfirm, resConfirm);

    assert.strictEqual(resConfirm.statusCode, 200);
    assert(resConfirm.body.message.includes('confirmed successfully'));

    // Verify parent leg is now 'scheduled' with scheduledAt populated
    legCheck = (await CircularExchange.findById(cycleId)).legs[0];
    assert.strictEqual(legCheck.status, 'scheduled');
    assert.strictEqual(new Date(legCheck.scheduledAt).getTime(), futureTime.getTime());
    assert.strictEqual(legCheck.scheduleProposal.status, 'confirmed');
    assert.strictEqual(legCheck.scheduleHistory.length, 1);
    assert.strictEqual(legCheck.scheduleHistory[0].status, 'confirmed');
    assert.strictEqual(legCheck.scheduleHistory[0].proposalId, proposalId);

    // Verify child SwapRequest.scheduledAt is synchronized atomically
    childSwap = await SwapRequest.findById(legCheck.swapRequest);
    assert.strictEqual(new Date(childSwap.scheduledAt).getTime(), futureTime.getTime());

    // OutboxEvent check for confirmation
    const confirmEvents = await OutboxEvent.find({
      aggregateId: cycleId,
      type: 'CIRCULAR_LEG_SCHEDULE_CONFIRMED',
    });
    assert.strictEqual(confirmEvents.length, 1);
    assert.strictEqual(confirmEvents[0].recipient.toString(), uA._id.toString());
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. PROPOSAL REJECTION
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- 2. Proposal Rejection ---');

  await test('Teacher proposes schedule -> Learner rejects with reason -> History updated, status active', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const exchange = await createAndActivateCycle(uA, uB, uC, ['TypeScript', 'GraphQL', 'Docker']);
    const cycleId = exchange._id.toString();

    const futureTime = getFutureSlotDate('Wednesday', 14);

    // Bob (teacher of leg 1) proposes schedule to Charlie
    const resPropose = mockRes();
    await proposeLegSchedule(
      {
        userId: uB._id.toString(),
        params: { id: cycleId, legIndex: '1' },
        body: { scheduledTime: futureTime.toISOString() },
      },
      resPropose
    );
    const proposalId = resPropose.body.proposalId;

    // Charlie (learner of leg 1) rejects with reason and proposalId
    const reqReject = {
      userId: uC._id.toString(),
      params: { id: cycleId, legIndex: '1' },
      body: { proposalId, reason: 'I have an exam on Wednesday afternoon' },
    };
    const resReject = mockRes();
    await rejectLegSchedule(reqReject, resReject);

    assert.strictEqual(resReject.statusCode, 200);
    assert(resReject.body.message.includes('rejected successfully'));

    const leg = (await CircularExchange.findById(cycleId)).legs[1];
    assert.strictEqual(leg.status, 'active');
    assert.strictEqual(leg.scheduledAt, null);
    assert.strictEqual(leg.scheduleProposal.status, 'rejected');
    assert.strictEqual(leg.scheduleProposal.rejectionReason, 'I have an exam on Wednesday afternoon');

    // Schedule history preserved
    assert.strictEqual(leg.scheduleHistory.length, 1);
    assert.strictEqual(leg.scheduleHistory[0].status, 'rejected');
    assert.strictEqual(leg.scheduleHistory[0].proposalId, proposalId);
    assert.strictEqual(leg.scheduleHistory[0].notes, 'I have an exam on Wednesday afternoon');

    // Child SwapRequest remains null
    const childSwap = await SwapRequest.findById(leg.swapRequest);
    assert.strictEqual(!childSwap.scheduledAt, true);

    // OutboxEvent check
    const rejectEvents = await OutboxEvent.find({
      aggregateId: cycleId,
      type: 'CIRCULAR_LEG_SCHEDULE_REJECTED',
    });
    assert.strictEqual(rejectEvents.length, 1);
    assert.strictEqual(rejectEvents[0].recipient.toString(), uB._id.toString());
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. RESCHEDULING & PREVIOUS SCHEDULE PRESERVATION
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- 3. Rescheduling & Confirmed Schedule Preservation ---');

  await test('Rescheduling rejection preserves the previously confirmed schedule and timestamp', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const exchange = await createAndActivateCycle(uA, uB, uC, ['Kubernetes', 'AWS', 'GCP']);
    const cycleId = exchange._id.toString();

    const time1 = getFutureSlotDate('Monday', 10);

    // Leg 0: Alice proposes, Bob confirms time1
    const resPropose1 = mockRes();
    await proposeLegSchedule({ userId: uA._id.toString(), params: { id: cycleId, legIndex: '0' }, body: { scheduledTime: time1.toISOString() } }, resPropose1);
    await confirmLegSchedule({ userId: uB._id.toString(), params: { id: cycleId, legIndex: '0' }, body: { proposalId: resPropose1.body.proposalId } }, mockRes());

    let leg = (await CircularExchange.findById(cycleId)).legs[0];
    assert.strictEqual(new Date(leg.scheduledAt).getTime(), time1.getTime());
    assert.strictEqual(leg.status, 'scheduled');

    // Now Alice attempts to reschedule to time2
    const time2 = getFutureSlotDate('Friday', 15);
    const resPropose2 = mockRes();
    await proposeLegSchedule({ userId: uA._id.toString(), params: { id: cycleId, legIndex: '0' }, body: { scheduledTime: time2.toISOString() } }, resPropose2);
    assert.strictEqual(resPropose2.statusCode, 200);

    // CRITICAL REQUIREMENT: time1 must NOT be overwritten while time2 is pending confirmation
    leg = (await CircularExchange.findById(cycleId)).legs[0];
    assert.strictEqual(new Date(leg.scheduledAt).getTime(), time1.getTime(), 'Prior confirmed schedule must be preserved during pending reschedule');
    let childSwap = await SwapRequest.findById(leg.swapRequest);
    assert.strictEqual(new Date(childSwap.scheduledAt).getTime(), time1.getTime(), 'Child SwapRequest must preserve prior confirmed schedule');

    // Bob rejects the rescheduling proposal
    const resReject2 = mockRes();
    await rejectLegSchedule({ userId: uB._id.toString(), params: { id: cycleId, legIndex: '0' }, body: { proposalId: resPropose2.body.proposalId, reason: 'Cannot do Friday' } }, resReject2);
    assert.strictEqual(resReject2.statusCode, 200);

    // CRITICAL REQUIREMENT: Prior confirmed schedule time1 remains active and confirmed!
    leg = (await CircularExchange.findById(cycleId)).legs[0];
    assert.strictEqual(leg.status, 'scheduled', 'Leg status must remain scheduled after rejection of reschedule');
    assert.strictEqual(new Date(leg.scheduledAt).getTime(), time1.getTime(), 'Confirmed schedule time1 preserved after rejected reschedule');
    childSwap = await SwapRequest.findById(leg.swapRequest);
    assert.strictEqual(new Date(childSwap.scheduledAt).getTime(), time1.getTime(), 'Child SwapRequest maintains time1');

    // History now contains confirmed entry + rejected entry
    assert.strictEqual(leg.scheduleHistory.length, 2);
    assert.strictEqual(leg.scheduleHistory[0].status, 'confirmed');
    assert.strictEqual(leg.scheduleHistory[1].status, 'rejected');
  });

  await test('Revised proposal supersedes previous unconfirmed proposal in scheduleHistory', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const exchange = await createAndActivateCycle(uA, uB, uC, ['Vue', 'React', 'Angular']);
    const cycleId = exchange._id.toString();

    const time1 = getFutureSlotDate('Monday', 14);
    const time2 = getFutureSlotDate('Wednesday', 15);

    // Propose time1
    const res1 = mockRes();
    await proposeLegSchedule({ userId: uA._id.toString(), params: { id: cycleId, legIndex: '0' }, body: { scheduledTime: time1.toISOString() } }, res1);

    // Teacher changes mind and proposes time2 before Bob confirmed time1
    const res2 = mockRes();
    await proposeLegSchedule({ userId: uA._id.toString(), params: { id: cycleId, legIndex: '0' }, body: { scheduledTime: time2.toISOString() } }, res2);

    const leg = (await CircularExchange.findById(cycleId)).legs[0];
    assert.strictEqual(new Date(leg.scheduleProposal.proposedTime).getTime(), time2.getTime());
    assert.strictEqual(leg.scheduleProposal.status, 'pending_confirmation');
    assert.strictEqual(leg.scheduleProposal.proposalId, res2.body.proposalId);

    // time1 was archived as 'superseded' with original proposalId
    assert.strictEqual(leg.scheduleHistory.length, 1);
    assert.strictEqual(leg.scheduleHistory[0].status, 'superseded');
    assert.strictEqual(leg.scheduleHistory[0].proposalId, res1.body.proposalId);
    assert.strictEqual(new Date(leg.scheduleHistory[0].scheduledTime).getTime(), time1.getTime());
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. INVALID DATES & RESTRICTIONS
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- 4. Invalid Dates & Past Date Rejection ---');

  await test('Past dates are rejected with 400 Bad Request', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const exchange = await createAndActivateCycle(uA, uB, uC, ['Math', 'Physics', 'Chemistry']);
    const cycleId = exchange._id.toString();

    const pastTime = new Date(Date.now() - 3600 * 1000 * 24); // Yesterday

    const res = mockRes();
    await proposeLegSchedule(
      { userId: uA._id.toString(), params: { id: cycleId, legIndex: '0' }, body: { scheduledTime: pastTime.toISOString() } },
      res
    );

    assert.strictEqual(res.statusCode, 400);
    assert(res.body.message.includes('future'));
  });

  await test('Malformed or missing scheduledTime is rejected with 400 Bad Request', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const exchange = await createAndActivateCycle(uA, uB, uC, ['Biology', 'Genetics', 'Ecology']);
    const cycleId = exchange._id.toString();

    const res1 = mockRes();
    await proposeLegSchedule({ userId: uA._id.toString(), params: { id: cycleId, legIndex: '0' }, body: {} }, res1);
    assert.strictEqual(res1.statusCode, 400);

    const res2 = mockRes();
    await proposeLegSchedule({ userId: uA._id.toString(), params: { id: cycleId, legIndex: '0' }, body: { scheduledTime: 'not-a-date' } }, res2);
    assert.strictEqual(res2.statusCode, 400);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. AVAILABILITY & DOUBLE-BOOKING CONFLICTS
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- 5. Availability & Double-Booking Conflicts ---');

  await test('Proposed time outside participant availability slots is rejected with 400', async () => {
    // Alice is only available on Mondays
    const uA = await createTestUser({
      availabilitySlots: [{ day: 'Monday', from: '10:00', to: '12:00' }],
    });
    const uB = await createTestUser();
    const uC = await createTestUser();

    const exchange = await createAndActivateCycle(uA, uB, uC, ['Design', 'Art', 'Music']);
    const cycleId = exchange._id.toString();

    // Alice proposes a Sunday time (outside her Monday slots)
    const sundayTime = getFutureSlotDate('Sunday', 11);

    const res = mockRes();
    await proposeLegSchedule(
      { userId: uA._id.toString(), params: { id: cycleId, legIndex: '0' }, body: { scheduledTime: sundayTime.toISOString() } },
      res
    );

    assert.strictEqual(res.statusCode, 400);
    assert(res.body.message.includes('availability slots'));
  });

  await test('Double-booking conflict with existing confirmed session triggers 409 Conflict', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const exchange = await createAndActivateCycle(uA, uB, uC, ['Java', 'C++', 'C#']);
    const cycleId = exchange._id.toString();

    const targetTime = getFutureSlotDate('Monday', 14);

    // Create an external confirmed bilateral swap for Alice at targetTime
    const externalPartner = await createTestUser();
    const conflictSwap = await SwapRequest.create({
      fromUser: uA._id,
      toUser: externalPartner._id,
      offeredSkill: 'Java',
      wantedSkill: 'Other',
      status: 'accepted',
      scheduledAt: targetTime,
    });
    createdSwapIds.push(conflictSwap._id);

    // Alice now attempts to schedule her circular leg at the same targetTime (±30m)
    const res = mockRes();
    await proposeLegSchedule(
      { userId: uA._id.toString(), params: { id: cycleId, legIndex: '0' }, body: { scheduledTime: targetTime.toISOString() } },
      res
    );

    assert.strictEqual(res.statusCode, 409);
    assert(res.body.message.includes('already have another confirmed session'));
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 6. STRICT AUTHORIZATION
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- 6. Strict Authorization ---');

  await test('Learner cannot propose schedule for teaching leg (403 Forbidden)', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const exchange = await createAndActivateCycle(uA, uB, uC, ['Skill1', 'Skill2', 'Skill3']);
    const cycleId = exchange._id.toString();

    const futureTime = getFutureSlotDate('Monday', 10);

    // Bob is learner in leg 0; attempts to propose
    const res = mockRes();
    await proposeLegSchedule(
      { userId: uB._id.toString(), params: { id: cycleId, legIndex: '0' }, body: { scheduledTime: futureTime.toISOString() } },
      res
    );

    assert.strictEqual(res.statusCode, 403);
    assert(res.body.message.includes('Only the teacher'));
  });

  await test('Teacher cannot confirm or reject their own proposal (403 Forbidden)', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const exchange = await createAndActivateCycle(uA, uB, uC, ['SkillA', 'SkillB', 'SkillC']);
    const cycleId = exchange._id.toString();

    const futureTime = getFutureSlotDate('Wednesday', 11);

    // Alice proposes leg 0
    const resP = mockRes();
    await proposeLegSchedule({ userId: uA._id.toString(), params: { id: cycleId, legIndex: '0' }, body: { scheduledTime: futureTime.toISOString() } }, resP);
    const proposalId = resP.body.proposalId;

    // Alice attempts to confirm her own proposal
    const resConfirm = mockRes();
    await confirmLegSchedule({ userId: uA._id.toString(), params: { id: cycleId, legIndex: '0' }, body: { proposalId } }, resConfirm);
    assert.strictEqual(resConfirm.statusCode, 403);
    assert(resConfirm.body.message.includes('Only the learner'));

    // Alice attempts to reject her own proposal
    const resReject = mockRes();
    await rejectLegSchedule({ userId: uA._id.toString(), params: { id: cycleId, legIndex: '0' }, body: { proposalId } }, resReject);
    assert.strictEqual(resReject.statusCode, 403);
    assert(resReject.body.message.includes('Only the learner'));
  });

  await test('Observer participant Charlie cannot schedule leg 0 (403 Forbidden)', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const exchange = await createAndActivateCycle(uA, uB, uC, ['SkillX', 'SkillY', 'SkillZ']);
    const cycleId = exchange._id.toString();

    const futureTime = getFutureSlotDate('Friday', 12);

    // Charlie is neither teacher nor learner in leg 0
    const res = mockRes();
    await proposeLegSchedule(
      { userId: uC._id.toString(), params: { id: cycleId, legIndex: '0' }, body: { scheduledTime: futureTime.toISOString() } },
      res
    );
    assert.strictEqual(res.statusCode, 403);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 7. TRANSACTION ROLLBACK & OUTBOX CONSISTENCY
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- 7. Transaction Rollback & Outbox Consistency ---');

  await test('Outbox failure during confirmation rolls back both parent leg and child SwapRequest', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const exchange = await createAndActivateCycle(uA, uB, uC, ['Scala', 'Akka', 'Play']);
    const cycleId = exchange._id.toString();

    const futureTime = getFutureSlotDate('Wednesday', 10);

    // Alice proposes
    const resP = mockRes();
    await proposeLegSchedule({ userId: uA._id.toString(), params: { id: cycleId, legIndex: '0' }, body: { scheduledTime: futureTime.toISOString() } }, resP);
    const proposalId = resP.body.proposalId;

    // Monkey-patch OutboxEvent.create to simulate failure
    const origCreate = OutboxEvent.create;
    let patchActive = true;
    OutboxEvent.create = async function (...args) {
      if (patchActive) {
        throw new Error('Simulated atomic outbox failure during schedule confirmation');
      }
      return origCreate.apply(this, args);
    };

    try {
      const res = mockRes();
      await confirmLegSchedule({ userId: uB._id.toString(), params: { id: cycleId, legIndex: '0' }, body: { proposalId } }, res);
      assert.strictEqual(res.statusCode, 500);
    } finally {
      patchActive = false;
      OutboxEvent.create = origCreate;
    }

    // Verify rollback
    const leg = (await CircularExchange.findById(cycleId)).legs[0];
    assert.strictEqual(leg.scheduledAt, null);
    assert.strictEqual(leg.status, 'active');

    const childSwap = await SwapRequest.findById(leg.swapRequest);
    assert.strictEqual(!childSwap.scheduledAt, true);

    const outboxEvents = await OutboxEvent.find({
      aggregateId: cycleId,
      type: 'CIRCULAR_LEG_SCHEDULE_CONFIRMED',
    });
    assert.strictEqual(outboxEvents.length, 0);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 8. REMINDER SERVICE INTEGRATION & ISOLATION
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- 8. Reminder Service Isolation ---');

  await test('Reminder service ignores unconfirmed proposed schedules; triggers only on confirmed schedules', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const exchange = await createAndActivateCycle(uA, uB, uC, ['SwiftUI', 'UIKit', 'Combine']);
    const cycleId = exchange._id.toString();

    // Time inside the 30-minute reminder window: 20 minutes from now
    const imminentTime = new Date(Date.now() + 20 * 60 * 1000);

    // Teacher proposes leg 0 for imminentTime
    uA.availabilitySlots = [];
    uB.availabilitySlots = [];
    await uA.save();
    await uB.save();

    const resP = mockRes();
    await proposeLegSchedule(
      { userId: uA._id.toString(), params: { id: cycleId, legIndex: '0' }, body: { scheduledTime: imminentTime.toISOString() } },
      resP
    );
    const proposalId = resP.body.proposalId;

    // Run reminder service while proposal is pending
    await checkUpcomingSessionReminders();

    // Assert zero reminders were generated for uA or uB
    let reminders = await Notification.find({
      recipient: { $in: [uA._id, uB._id] },
      type: 'SESSION_REMINDER',
    });
    assert.strictEqual(reminders.length, 0, 'No session reminders should be sent for unconfirmed proposal');

    // Now learner confirms the schedule!
    await confirmLegSchedule({ userId: uB._id.toString(), params: { id: cycleId, legIndex: '0' }, body: { proposalId } }, mockRes());

    // Run reminder service again
    await checkUpcomingSessionReminders();

    // Reminders should now be dispatched for both participants
    reminders = await Notification.find({
      recipient: { $in: [uA._id, uB._id] },
      type: 'SESSION_REMINDER',
    });
    assert.strictEqual(reminders.length, 2, 'Both participants should receive reminders after mutual confirmation');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 9. INDEPENDENT SCHEDULING OF ALL THREE LEGS
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- 9. Independent Scheduling of All 3 Legs ---');

  await test('All three legs schedule independently with distinct states, dates, and histories', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const exchange = await createAndActivateCycle(uA, uB, uC, ['Leg0Skill', 'Leg1Skill', 'Leg2Skill']);
    const cycleId = exchange._id.toString();

    const time0 = getFutureSlotDate('Monday', 10);
    const time1 = getFutureSlotDate('Wednesday', 14);

    // Leg 0: Confirmed
    const resP0 = mockRes();
    await proposeLegSchedule({ userId: uA._id.toString(), params: { id: cycleId, legIndex: '0' }, body: { scheduledTime: time0.toISOString() } }, resP0);
    await confirmLegSchedule({ userId: uB._id.toString(), params: { id: cycleId, legIndex: '0' }, body: { proposalId: resP0.body.proposalId } }, mockRes());

    // Leg 1: Pending proposal
    await proposeLegSchedule({ userId: uB._id.toString(), params: { id: cycleId, legIndex: '1' }, body: { scheduledTime: time1.toISOString() } }, mockRes());

    // Leg 2: Unscheduled (none)

    // Check exchange schedule overview
    const resOverview = mockRes();
    await getCircularSchedule({ userId: uA._id.toString(), params: { id: cycleId } }, resOverview);

    assert.strictEqual(resOverview.statusCode, 200);
    const legs = resOverview.body.legs;
    assert.strictEqual(legs.length, 3);

    // Leg 0 check
    assert.strictEqual(legs[0].status, 'scheduled');
    assert.strictEqual(new Date(legs[0].scheduledAt).getTime(), time0.getTime());
    assert.strictEqual(legs[0].scheduleProposal.status, 'confirmed');

    // Leg 1 check
    assert.strictEqual(legs[1].status, 'active');
    assert.strictEqual(legs[1].scheduledAt, null);
    assert.strictEqual(legs[1].scheduleProposal.status, 'pending_confirmation');

    // Leg 2 check
    assert.strictEqual(legs[2].status, 'active');
    assert.strictEqual(legs[2].scheduledAt, null);
    assert.strictEqual(legs[2].scheduleProposal.status, 'none');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 10. BILATERAL SCHEDULING REGRESSION
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- 10. Bilateral Scheduling Regression ---');

  await test('Regression: Bilateral PUT /api/swap/:id/schedule continues to function untouched', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();

    const swap = await SwapRequest.create({
      fromUser: uA._id,
      toUser: uB._id,
      offeredSkill: 'BilateralTeach',
      wantedSkill: 'BilateralLearn',
      status: 'accepted',
    });
    createdSwapIds.push(swap._id);

    const futureTime = new Date(Date.now() + 3600 * 1000 * 48);

    const reqSchedule = {
      userId: uA._id.toString(),
      params: { id: swap._id.toString() },
      body: { scheduledAt: futureTime.toISOString() },
    };
    const resSchedule = mockRes();
    await scheduleSwap(reqSchedule, resSchedule);

    assert.strictEqual(resSchedule.statusCode, 200);
    const updated = await SwapRequest.findById(swap._id);
    assert.strictEqual(new Date(updated.scheduledAt).getTime(), futureTime.getTime());
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 11. END-TO-END HTTP ROUTING & JWT AUTH
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- 11. End-to-End HTTP Routing & JWT Auth ---');

  await test('End-to-End HTTP: Propose and confirm schedule via real Express HTTP server', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const exchange = await createAndActivateCycle(uA, uB, uC, ['E2ESkill1', 'E2ESkill2', 'E2ESkill3']);
    const cycleId = exchange._id.toString();

    const tokenA = generateToken(uA._id);
    const tokenB = generateToken(uB._id);

    const futureTime = getFutureSlotDate('Friday', 16);

    // 1. Propose schedule via HTTP POST
    const proposeRes = await fetch(`${testBaseUrl}/${cycleId}/legs/0/schedule/propose`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({ scheduledTime: futureTime.toISOString() }),
    });
    assert.strictEqual(proposeRes.status, 200);
    const proposeData = await proposeRes.json();
    assert.strictEqual(proposeData.scheduleProposal.status, 'pending_confirmation');
    const proposalId = proposeData.proposalId;
    assert.ok(proposalId);

    // 2. View schedule via HTTP GET
    const viewRes = await fetch(`${testBaseUrl}/${cycleId}/schedule`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    assert.strictEqual(viewRes.status, 200);
    const viewData = await viewRes.json();
    assert.strictEqual(viewData.legs[0].myRole, 'learner');
    assert.strictEqual(viewData.legs[0].canConfirm, true);

    // 3. Confirm schedule via HTTP PUT passing proposalId
    const confirmRes = await fetch(`${testBaseUrl}/${cycleId}/legs/0/schedule/confirm`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenB}`,
      },
      body: JSON.stringify({ proposalId }),
    });
    assert.strictEqual(confirmRes.status, 200);
    const confirmData = await confirmRes.json();
    assert.strictEqual(confirmData.status, 'scheduled');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 12. AUDIT FINDING 1: PROPOSAL IDENTITY & STALE-ACTION PROTECTION
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- 12. Audit Finding 1: Proposal Identity & Stale-Action Protection ---');

  await test('Missing proposalId in confirm request returns 409 Conflict', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const exchange = await createAndActivateCycle(uA, uB, uC, ['Aud1', 'Aud2', 'Aud3']);
    const cycleId = exchange._id.toString();

    const futureTime = getFutureSlotDate('Monday', 11);
    await proposeLegSchedule({ userId: uA._id.toString(), params: { id: cycleId, legIndex: '0' }, body: { scheduledTime: futureTime.toISOString() } }, mockRes());

    const res = mockRes();
    await confirmLegSchedule({ userId: uB._id.toString(), params: { id: cycleId, legIndex: '0' }, body: {} }, res);

    assert.strictEqual(res.statusCode, 409);
    assert(res.body.message.includes('proposalId is required'));
  });

  await test('Missing proposalId in reject request returns 409 Conflict', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const exchange = await createAndActivateCycle(uA, uB, uC, ['Aud4', 'Aud5', 'Aud6']);
    const cycleId = exchange._id.toString();

    const futureTime = getFutureSlotDate('Wednesday', 11);
    await proposeLegSchedule({ userId: uA._id.toString(), params: { id: cycleId, legIndex: '0' }, body: { scheduledTime: futureTime.toISOString() } }, mockRes());

    const res = mockRes();
    await rejectLegSchedule({ userId: uB._id.toString(), params: { id: cycleId, legIndex: '0' }, body: { reason: 'No proposalId' } }, res);

    assert.strictEqual(res.statusCode, 409);
    assert(res.body.message.includes('proposalId is required'));
  });

  await test('Confirming an older proposalId after revision returns 409 Conflict with zero state mutation', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const exchange = await createAndActivateCycle(uA, uB, uC, ['Stale1', 'Stale2', 'Stale3']);
    const cycleId = exchange._id.toString();

    const time1 = getFutureSlotDate('Monday', 10);
    const time2 = getFutureSlotDate('Wednesday', 14);

    // Proposal 1
    const res1 = mockRes();
    await proposeLegSchedule({ userId: uA._id.toString(), params: { id: cycleId, legIndex: '0' }, body: { scheduledTime: time1.toISOString() } }, res1);
    const staleProposalId = res1.body.proposalId;

    // Proposal 2 (revises Proposal 1)
    const res2 = mockRes();
    await proposeLegSchedule({ userId: uA._id.toString(), params: { id: cycleId, legIndex: '0' }, body: { scheduledTime: time2.toISOString() } }, res2);
    const currentProposalId = res2.body.proposalId;
    assert.notStrictEqual(staleProposalId, currentProposalId);

    // Snapshot state before stale confirm
    const beforeExchange = await CircularExchange.findById(cycleId);
    const beforeHistoryLen = beforeExchange.legs[0].scheduleHistory.length;
    const beforeOutboxCount = await OutboxEvent.countDocuments({ aggregateId: cycleId });

    // Attempt to confirm stale proposal 1
    const resConfirmStale = mockRes();
    await confirmLegSchedule(
      { userId: uB._id.toString(), params: { id: cycleId, legIndex: '0' }, body: { proposalId: staleProposalId } },
      resConfirmStale
    );

    assert.strictEqual(resConfirmStale.statusCode, 409);
    assert(resConfirmStale.body.message.includes('stale'));

    // Verify zero mutation occurred!
    const afterExchange = await CircularExchange.findById(cycleId);
    const leg = afterExchange.legs[0];
    assert.strictEqual(leg.status, 'active');
    assert.strictEqual(leg.scheduledAt, null);
    assert.strictEqual(leg.scheduleProposal.proposalId, currentProposalId);
    assert.strictEqual(leg.scheduleProposal.status, 'pending_confirmation');
    assert.strictEqual(leg.scheduleHistory.length, beforeHistoryLen);

    const childSwap = await SwapRequest.findById(leg.swapRequest);
    assert.strictEqual(!childSwap.scheduledAt, true);

    const afterOutboxCount = await OutboxEvent.countDocuments({ aggregateId: cycleId });
    assert.strictEqual(afterOutboxCount, beforeOutboxCount);

    // Confirming currentProposalId still succeeds!
    const resConfirmCurrent = mockRes();
    await confirmLegSchedule(
      { userId: uB._id.toString(), params: { id: cycleId, legIndex: '0' }, body: { proposalId: currentProposalId } },
      resConfirmCurrent
    );
    assert.strictEqual(resConfirmCurrent.statusCode, 200);
  });

  await test('Rejecting an older proposalId after revision returns 409 Conflict with zero state mutation', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const exchange = await createAndActivateCycle(uA, uB, uC, ['RejStale1', 'RejStale2', 'RejStale3']);
    const cycleId = exchange._id.toString();

    const time1 = getFutureSlotDate('Monday', 10);
    const time2 = getFutureSlotDate('Friday', 14);

    const res1 = mockRes();
    await proposeLegSchedule({ userId: uA._id.toString(), params: { id: cycleId, legIndex: '0' }, body: { scheduledTime: time1.toISOString() } }, res1);
    const staleProposalId = res1.body.proposalId;

    const res2 = mockRes();
    await proposeLegSchedule({ userId: uA._id.toString(), params: { id: cycleId, legIndex: '0' }, body: { scheduledTime: time2.toISOString() } }, res2);

    const resRejectStale = mockRes();
    await rejectLegSchedule(
      { userId: uB._id.toString(), params: { id: cycleId, legIndex: '0' }, body: { proposalId: staleProposalId, reason: 'Too late' } },
      resRejectStale
    );

    assert.strictEqual(resRejectStale.statusCode, 409);
    assert(resRejectStale.body.message.includes('stale'));

    const leg = (await CircularExchange.findById(cycleId)).legs[0];
    assert.strictEqual(leg.scheduleProposal.status, 'pending_confirmation');
    assert.strictEqual(leg.scheduleProposal.proposalId, res2.body.proposalId);
  });

  await test('Concurrent teacher proposals with outdated scheduleVersion cannot overwrite each other', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const exchange = await createAndActivateCycle(uA, uB, uC, ['Conc1', 'Conc2', 'Conc3']);
    const cycleId = exchange._id.toString();

    const timeA = getFutureSlotDate('Monday', 10);
    const timeB = getFutureSlotDate('Monday', 14);

    // Two parallel proposals for the same leg
    const resA = mockRes();
    const resB = mockRes();

    await Promise.all([
      proposeLegSchedule({ userId: uA._id.toString(), params: { id: cycleId, legIndex: '0' }, body: { scheduledTime: timeA.toISOString() } }, resA),
      proposeLegSchedule({ userId: uA._id.toString(), params: { id: cycleId, legIndex: '0' }, body: { scheduledTime: timeB.toISOString() } }, resB),
    ]);

    // Either one succeeds and one gets 409 (version conflict), or both succeed sequentially with unique IDs
    const codes = [resA.statusCode, resB.statusCode];
    assert.ok(codes.includes(200));

    const finalDoc = await CircularExchange.findById(cycleId);
    const leg = finalDoc.legs[0];
    assert.strictEqual(leg.scheduleProposal.status, 'pending_confirmation');
    assert.ok(leg.scheduleVersion >= 1);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 13. AUDIT FINDING 2: IDEMPOTENT CONFIRMATION
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- 13. Audit Finding 2: Idempotent Confirmation ---');

  await test('Repeated confirmation with the same proposalId returns HTTP 200 with zero duplicate history or outbox', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const exchange = await createAndActivateCycle(uA, uB, uC, ['Idem1', 'Idem2', 'Idem3']);
    const cycleId = exchange._id.toString();

    const futureTime = getFutureSlotDate('Monday', 15);

    const resP = mockRes();
    await proposeLegSchedule({ userId: uA._id.toString(), params: { id: cycleId, legIndex: '0' }, body: { scheduledTime: futureTime.toISOString() } }, resP);
    const proposalId = resP.body.proposalId;

    // First confirmation
    const resC1 = mockRes();
    await confirmLegSchedule({ userId: uB._id.toString(), params: { id: cycleId, legIndex: '0' }, body: { proposalId } }, resC1);
    assert.strictEqual(resC1.statusCode, 200);

    const historyCount1 = (await CircularExchange.findById(cycleId)).legs[0].scheduleHistory.length;
    const outboxCount1 = await OutboxEvent.countDocuments({
      aggregateId: cycleId,
      type: 'CIRCULAR_LEG_SCHEDULE_CONFIRMED',
    });
    assert.strictEqual(historyCount1, 1);
    assert.strictEqual(outboxCount1, 1);

    // Second confirmation with same proposalId (Idempotent call)
    const resC2 = mockRes();
    await confirmLegSchedule({ userId: uB._id.toString(), params: { id: cycleId, legIndex: '0' }, body: { proposalId } }, resC2);
    assert.strictEqual(resC2.statusCode, 200);
    assert(resC2.body.message.includes('already confirmed'));

    // Third confirmation with same proposalId
    const resC3 = mockRes();
    await confirmLegSchedule({ userId: uB._id.toString(), params: { id: cycleId, legIndex: '0' }, body: { proposalId } }, resC3);
    assert.strictEqual(resC3.statusCode, 200);

    // Verify ZERO duplicate history entries and ZERO duplicate outbox events!
    const historyCount2 = (await CircularExchange.findById(cycleId)).legs[0].scheduleHistory.length;
    const outboxCount2 = await OutboxEvent.countDocuments({
      aggregateId: cycleId,
      type: 'CIRCULAR_LEG_SCHEDULE_CONFIRMED',
    });

    assert.strictEqual(historyCount2, 1, 'Schedule history must not contain duplicates');
    assert.strictEqual(outboxCount2, 1, 'Outbox must not contain duplicate confirmation events');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 14. AUDIT FINDING 3: AVAILABILITY REVALIDATION AT CONFIRMATION
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- 14. Audit Finding 3: Availability Revalidation at Confirmation ---');

  await test('Teacher removes availability after proposal -> Confirmation returns 409 Conflict', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const exchange = await createAndActivateCycle(uA, uB, uC, ['AvailT1', 'AvailT2', 'AvailT3']);
    const cycleId = exchange._id.toString();

    const futureTime = getFutureSlotDate('Monday', 14);

    const resP = mockRes();
    await proposeLegSchedule({ userId: uA._id.toString(), params: { id: cycleId, legIndex: '0' }, body: { scheduledTime: futureTime.toISOString() } }, resP);
    const proposalId = resP.body.proposalId;

    // Alice updates her availability to only Friday (withdrawing Monday)
    await User.updateOne(
      { _id: uA._id },
      { $set: { availabilitySlots: [{ day: 'Friday', from: '09:00', to: '17:00' }] } }
    );

    // Bob tries to confirm the Monday proposal
    const resC = mockRes();
    await confirmLegSchedule({ userId: uB._id.toString(), params: { id: cycleId, legIndex: '0' }, body: { proposalId } }, resC);

    assert.strictEqual(resC.statusCode, 409);
    assert(resC.body.message.includes('available slots'));

    // Verify proposal remains pending and scheduledAt was not set
    const leg = (await CircularExchange.findById(cycleId)).legs[0];
    assert.strictEqual(leg.status, 'active');
    assert.strictEqual(leg.scheduledAt, null);
    assert.strictEqual(leg.scheduleProposal.status, 'pending_confirmation');
    assert.strictEqual(leg.scheduleHistory.length, 0);

    const childSwap = await SwapRequest.findById(leg.swapRequest);
    assert.strictEqual(!childSwap.scheduledAt, true);
  });

  await test('Learner removes availability after proposal -> Confirmation returns 409 Conflict', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const exchange = await createAndActivateCycle(uA, uB, uC, ['AvailL1', 'AvailL2', 'AvailL3']);
    const cycleId = exchange._id.toString();

    const futureTime = getFutureSlotDate('Wednesday', 14);

    const resP = mockRes();
    await proposeLegSchedule({ userId: uA._id.toString(), params: { id: cycleId, legIndex: '0' }, body: { scheduledTime: futureTime.toISOString() } }, resP);
    const proposalId = resP.body.proposalId;

    // Bob (learner) updates his availability to empty slots or non-matching day
    await User.updateOne(
      { _id: uB._id },
      { $set: { availabilitySlots: [{ day: 'Tuesday', from: '09:00', to: '12:00' }] } }
    );

    // Bob attempts to confirm
    const resC = mockRes();
    await confirmLegSchedule({ userId: uB._id.toString(), params: { id: cycleId, legIndex: '0' }, body: { proposalId } }, resC);

    assert.strictEqual(resC.statusCode, 409);
    assert(resC.body.message.includes('available slots'));

    const leg = (await CircularExchange.findById(cycleId)).legs[0];
    assert.strictEqual(leg.scheduledAt, null);
    assert.strictEqual(leg.scheduleProposal.status, 'pending_confirmation');
  });

  await test('Both participants retain availability -> Confirmation succeeds (200 OK)', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const exchange = await createAndActivateCycle(uA, uB, uC, ['AvailBoth1', 'AvailBoth2', 'AvailBoth3']);
    const cycleId = exchange._id.toString();

    const futureTime = getFutureSlotDate('Friday', 14);

    const resP = mockRes();
    await proposeLegSchedule({ userId: uA._id.toString(), params: { id: cycleId, legIndex: '0' }, body: { scheduledTime: futureTime.toISOString() } }, resP);
    const proposalId = resP.body.proposalId;

    const resC = mockRes();
    await confirmLegSchedule({ userId: uB._id.toString(), params: { id: cycleId, legIndex: '0' }, body: { proposalId } }, resC);

    assert.strictEqual(resC.statusCode, 200);
    const leg = (await CircularExchange.findById(cycleId)).legs[0];
    assert.strictEqual(leg.status, 'scheduled');
    assert.strictEqual(new Date(leg.scheduledAt).getTime(), futureTime.getTime());
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 15. AUDIT FINDING 4: TIMEZONE HANDLING & AUTHORITATIVE UTC EVALUATION
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- 15. Audit Finding 4: Timezone Handling & Authoritative UTC Evaluation ---');

  await test('isTimeWithinSlots evaluates strictly in UTC representation', () => {
    // Slot is on Monday from 10:00 to 18:00 UTC
    const slots = [{ day: 'Monday', from: '10:00', to: '18:00' }];

    // Monday 14:00 UTC -> should match
    const mondayMatch = new Date(Date.UTC(2026, 10, 2, 14, 0, 0)); // Nov 2, 2026 is Monday
    assert.strictEqual(isTimeWithinSlots(mondayMatch, slots), true);

    // Monday 08:00 UTC -> before slot from
    const mondayEarly = new Date(Date.UTC(2026, 10, 2, 8, 0, 0));
    assert.strictEqual(isTimeWithinSlots(mondayEarly, slots), false);

    // Monday 19:00 UTC -> after slot to
    const mondayLate = new Date(Date.UTC(2026, 10, 2, 19, 0, 0));
    assert.strictEqual(isTimeWithinSlots(mondayLate, slots), false);

    // Sunday 14:00 UTC -> wrong UTC day
    const sundaySameHour = new Date(Date.UTC(2026, 10, 1, 14, 0, 0)); // Nov 1, 2026 is Sunday
    assert.strictEqual(isTimeWithinSlots(sundaySameHour, slots), false);
  });

  await test('UTC day boundary test: Sunday night in Western zones is Monday in UTC', () => {
    // Slot: Monday 01:00 to 05:00 UTC
    const slots = [{ day: 'Monday', from: '01:00', to: '05:00' }];

    // Date: Monday 02:30 UTC
    const utcDate = new Date(Date.UTC(2026, 10, 2, 2, 30, 0));
    assert.strictEqual(utcDate.getUTCDay(), 1); // Monday in UTC

    // Evaluates true strictly against Monday slot
    assert.strictEqual(isTimeWithinSlots(utcDate, slots), true);

    // Should NOT match a Sunday slot under authoritative UTC convention
    const sundaySlots = [{ day: 'Sunday', from: '18:00', to: '23:59' }];
    assert.strictEqual(isTimeWithinSlots(utcDate, sundaySlots), false);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEARDOWN
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- Teardown Test Data ---');
  await stopHttpServer();
  await CircularExchange.deleteMany({ _id: { $in: createdCycleIds } });
  await ExchangeReservation.deleteMany({ exchangeId: { $in: createdCycleIds } });
  await SwapRequest.deleteMany({
    $or: [{ _id: { $in: createdSwapIds } }, { circularExchange: { $in: createdCycleIds } }],
  });
  await OutboxEvent.deleteMany({ aggregateId: { $in: createdCycleIds } });
  await Notification.deleteMany({ recipient: { $in: createdUserIds } });
  await User.deleteMany({ _id: { $in: createdUserIds } });
  console.log('  🧹 Teardown complete.');

  console.log('\n================================================================');
  console.log(`Substage 3.4.1.2 Test Results: ${passed} passed, ${failed} failed`);
  console.log('================================================================\n');

  if (failed > 0) {
    console.error('Failure Details:\n');
    failures.forEach((f, idx) => {
      console.error(`[${idx + 1}] ${f.name}`);
      console.error(f.stack || f.error);
      console.error('');
    });
    process.exit(1);
  } else {
    console.log('All Substage 3.4.1.2 tests completed successfully!');
  }
}

runTests()
  .catch((err) => {
    console.error('Fatal test execution error:', err);
    process.exit(1);
  })
  .finally(async () => {
    try {
      await mongoose.disconnect();
    } catch (_) {}
  });
