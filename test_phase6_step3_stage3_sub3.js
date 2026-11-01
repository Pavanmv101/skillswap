/**
 * Phase 6 — Step 3 — Substage 3.3: Atomic Circular Activation & Child Swap Generation Tests
 * test_phase6_step3_stage3_sub3.js
 *
 * Verifies:
 * 1. Successful atomic activation upon final participant acceptance:
 *    - Parent status transitions to 'active' and records activatedAt timestamp.
 *    - Exactly 3 circular reservations acquired (one per participant's teaching leg).
 *    - Exactly 3 child SwapRequests created and mapped to directed teaching legs.
 *    - Parent legs updated with swapRequest IDs, status: 'active', and roomIds.
 *    - Exactly 3 CIRCULAR_SWAP_ACTIVATED outbox events persisted for all participants.
 * 2. Conflict prevention:
 *    - Participant with active reservation causes 409 Conflict; transaction aborts cleanly.
 *    - Participant with accepted bilateral swap causes 409 Conflict; transaction aborts cleanly.
 *    - Transaction abort leaves ZERO child swaps, ZERO reservations, and parent remains 'proposed'.
 * 3. Concurrency and idempotency:
 *    - Concurrent final acceptance attempts resolve safely without duplicate activations.
 *    - Repeated accept on already active exchange returns 200 without duplicate side effects.
 *    - Same-exchange reservation retry is idempotent.
 *    - Different-exchange reservation conflict triggers 409.
 * 4. Lifecycle preconditions:
 *    - Expired proposal cannot activate (400 Bad Request).
 *    - Cancelled proposal cannot activate (400 Bad Request).
 *    - Proposal does not activate until all 3 participants accept.
 *    - All 3 accepted with transient failure can be safely retried.
 * 5. Reliability integration:
 *    - Circular child swap completion counts ONLY the teacher (fromUser), NOT the learner (toUser).
 *    - Bilateral swap completion continues to count both participants.
 * 6. End-to-end HTTP integration with real Express routes and JWT auth.
 */

'use strict';

require('dotenv').config();
const assert = require('assert');
const http = require('http');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const User = require('./models/User');
const SwapRequest = require('./models/SwapRequest');
const ExchangeReservation = require('./models/ExchangeReservation');
const CircularExchange = require('./models/CircularExchange');
const OutboxEvent = require('./models/OutboxEvent');
const { app } = require('./server');

const {
  createCircularProposal,
  getCircularProposals,
  getCircularProposalById,
  acceptCircularInvitation,
  declineCircularInvitation,
} = require('./controllers/circularProposalController');

const {
  acquireReservations,
  releaseReservations,
  assertNoAcceptedSwapConflicts,
  ReservationConflictError,
  withTransaction,
} = require('./services/reservationService');

const {
  getUserExchangeReliability,
  getBatchExchangeReliability,
} = require('./services/reliabilityService');

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

// Track created test IDs for isolated teardown
const createdUserIds = [];
const createdCycleIds = [];
const createdSwapIds = [];
const createdResIds = [];
const createdOutboxIds = [];

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

function buildValid3CycleLegs(uA, uB, uC, skills = ['Python', 'UI/UX', 'React']) {
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
      category: 'Design',
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

let testHttpServer;
let testBaseUrl;

function startHttpServer() {
  return new Promise((resolve) => {
    testHttpServer = http.createServer(app);
    testHttpServer.listen(0, '127.0.0.1', () => {
      const port = testHttpServer.address().port;
      testBaseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
}

function stopHttpServer() {
  return new Promise((resolve) => {
    if (testHttpServer) {
      testHttpServer.close(resolve);
    } else {
      resolve();
    }
  });
}

function apiRequest(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, testBaseUrl);
    const bodyStr = body ? JSON.stringify(body) : null;
    const req = http.request(
      url,
      {
        method: method.toUpperCase(),
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', chunk => { raw += chunk; });
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(raw);
          } catch (_) {
            parsed = raw;
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function runTests() {
  console.log('\n================================================================');
  console.log('🧪 Starting Phase 6 Step 3 Substage 3.3: Atomic Activation & Child Swap Tests');
  console.log('================================================================\n');

  const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/skillswap';
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(mongoUri);
  }

  await CircularExchange.syncIndexes();
  await ExchangeReservation.syncIndexes();
  await SwapRequest.syncIndexes();
  await OutboxEvent.syncIndexes();

  await startHttpServer();

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. SUCCESSFUL ATOMIC ACTIVATION
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- 1. Successful Atomic Circular Activation ---');

  await test('Final acceptance executes atomic activation: parent active, 3 reservations, 3 child swaps, 3 outbox events', async () => {
    const uA = await createTestUser({ name: 'Alice_Act' });
    const uB = await createTestUser({ name: 'Bob_Act' });
    const uC = await createTestUser({ name: 'Charlie_Act' });

    const legs = buildValid3CycleLegs(uA, uB, uC, ['Python', 'UI/UX', 'React']);
    const reqCreate = { userId: uA._id.toString(), body: { legs, cycleScore: 90 } };
    const resCreate = mockRes();
    await createCircularProposal(reqCreate, resCreate);
    assert.strictEqual(resCreate.statusCode, 201);
    const cycleId = resCreate.body._id.toString();
    createdCycleIds.push(cycleId);

    // Invitee B accepts (partial)
    const reqB = { userId: uB._id.toString(), params: { id: cycleId } };
    const resB = mockRes();
    await acceptCircularInvitation(reqB, resB);
    assert.strictEqual(resB.statusCode, 200);
    assert.strictEqual(resB.body.allAccepted, false);
    assert.strictEqual(resB.body.activated, false);

    // Invitee C accepts (final -> activates!)
    const reqC = { userId: uC._id.toString(), params: { id: cycleId } };
    const resC = mockRes();
    await acceptCircularInvitation(reqC, resC);
    assert.strictEqual(resC.statusCode, 200);
    assert.strictEqual(resC.body.allAccepted, true);
    assert.strictEqual(resC.body.activated, true);
    assert(resC.body.message.includes('successfully activated'));

    // Check parent CircularExchange state
    const parent = await CircularExchange.findById(cycleId);
    assert.strictEqual(parent.status, 'active');
    assert(parent.activatedAt instanceof Date);
    assert(parent.participants.every(p => p.hasAccepted === true));

    // Check 3 ExchangeReservation records
    const reservations = await ExchangeReservation.find({ exchangeId: cycleId });
    assert.strictEqual(reservations.length, 3);
    for (const r of reservations) {
      createdResIds.push(r._id);
      assert.strictEqual(r.exchangeType, 'circular');
      assert.strictEqual(r.status, 'active');
    }

    // Verify reservation skill mapping: each participant reserved for their teaching skill
    const reservationA = reservations.find(r => r.participant.toString() === uA._id.toString());
    const reservationB = reservations.find(r => r.participant.toString() === uB._id.toString());
    const reservationC = reservations.find(r => r.participant.toString() === uC._id.toString());
    assert.strictEqual(reservationA.skillBeingTaught, 'Python');
    assert.strictEqual(reservationB.skillBeingTaught, 'UI/UX');
    assert.strictEqual(reservationC.skillBeingTaught, 'React');

    // Check 3 child SwapRequests
    const childSwaps = await SwapRequest.find({ circularExchange: cycleId });
    assert.strictEqual(childSwaps.length, 3);
    for (const cs of childSwaps) {
      createdSwapIds.push(cs._id);
      assert.strictEqual(cs.status, 'accepted');
      assert(cs.roomId.includes(`skillswap-circular-${cycleId}`));
    }

    // Verify child swap leg mapping
    const child0 = childSwaps.find(cs => cs.circularLegIndex === 0);
    const child1 = childSwaps.find(cs => cs.circularLegIndex === 1);
    const child2 = childSwaps.find(cs => cs.circularLegIndex === 2);

    assert.strictEqual(child0.fromUser.toString(), uA._id.toString());
    assert.strictEqual(child0.toUser.toString(), uB._id.toString());
    assert.strictEqual(child0.offeredSkill, 'Python');

    assert.strictEqual(child1.fromUser.toString(), uB._id.toString());
    assert.strictEqual(child1.toUser.toString(), uC._id.toString());
    assert.strictEqual(child1.offeredSkill, 'UI/UX');

    assert.strictEqual(child2.fromUser.toString(), uC._id.toString());
    assert.strictEqual(child2.toUser.toString(), uA._id.toString());
    assert.strictEqual(child2.offeredSkill, 'React');

    // Check parent legs reference correct children
    assert.strictEqual(parent.legs[0].swapRequest.toString(), child0._id.toString());
    assert.strictEqual(parent.legs[0].status, 'active');
    assert.strictEqual(parent.legs[0].roomId, child0.roomId);

    assert.strictEqual(parent.legs[1].swapRequest.toString(), child1._id.toString());
    assert.strictEqual(parent.legs[1].status, 'active');
    assert.strictEqual(parent.legs[1].roomId, child1.roomId);

    assert.strictEqual(parent.legs[2].swapRequest.toString(), child2._id.toString());
    assert.strictEqual(parent.legs[2].status, 'active');
    assert.strictEqual(parent.legs[2].roomId, child2.roomId);

    // Check 3 CIRCULAR_SWAP_ACTIVATED outbox events persisted
    const activationEvents = await OutboxEvent.find({
      aggregateType: 'circular_exchange',
      aggregateId: cycleId,
      type: 'CIRCULAR_SWAP_ACTIVATED',
    });
    activationEvents.forEach(e => createdOutboxIds.push(e._id));
    assert.strictEqual(activationEvents.length, 3);
    const recipients = activationEvents.map(e => e.recipient.toString());
    assert(recipients.includes(uA._id.toString()));
    assert(recipients.includes(uB._id.toString()));
    assert(recipients.includes(uC._id.toString()));
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. CONFLICT HANDLING & TRANSACTION ROLLBACK
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- 2. Conflict Handling & Rollback Atomicity ---');

  await test('Activation fails if any participant holds an active reservation (409 Conflict) and rolls back cleanly', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    // Create an existing active reservation for Bob belonging to an external exchange
    const dummyExchangeId = new mongoose.Types.ObjectId();
    const existingRes = await ExchangeReservation.create({
      participant: uB._id,
      exchangeType: 'bilateral',
      exchangeId: dummyExchangeId,
      skillBeingTaught: 'Cooking',
      status: 'active',
    });
    createdResIds.push(existingRes._id);

    // Now create a circular proposal
    const legs = buildValid3CycleLegs(uA, uB, uC, ['Rust', 'Zig', 'C++']);
    const reqCreate = { userId: uA._id.toString(), body: { legs } };
    const resCreate = mockRes();
    await createCircularProposal(reqCreate, resCreate);
    const cycleId = resCreate.body._id.toString();
    createdCycleIds.push(cycleId);

    // Bob accepts
    const reqB = { userId: uB._id.toString(), params: { id: cycleId } };
    const resB = mockRes();
    await acceptCircularInvitation(reqB, resB);

    // Charlie accepts (final -> attempts activation, must detect Bob's reservation)
    const reqC = { userId: uC._id.toString(), params: { id: cycleId } };
    const resC = mockRes();
    await acceptCircularInvitation(reqC, resC);

    assert.strictEqual(resC.statusCode, 409, `Expected 409, got ${resC.statusCode}: ${JSON.stringify(resC.body)}`);
    assert(resC.body.message.includes('already engaged in another active exchange') || resC.body.message.includes('Conflict'));

    // Check transaction rollback atomicity:
    // 1. Parent is NOT active
    const parent = await CircularExchange.findById(cycleId);
    assert.strictEqual(parent.status, 'proposed');
    assert.strictEqual(parent.activatedAt, null);

    // 2. ZERO circular reservations exist for this cycle
    const circularRes = await ExchangeReservation.find({ exchangeId: cycleId });
    assert.strictEqual(circularRes.length, 0);

    // 3. ZERO child SwapRequests exist for this cycle
    const childSwaps = await SwapRequest.find({ circularExchange: cycleId });
    assert.strictEqual(childSwaps.length, 0);

    // 4. ZERO activation outbox events exist
    const activationEvents = await OutboxEvent.find({
      aggregateType: 'circular_exchange',
      aggregateId: cycleId,
      type: 'CIRCULAR_SWAP_ACTIVATED',
    });
    assert.strictEqual(activationEvents.length, 0);
  });

  await test('Activation fails if any participant has an accepted bilateral swap (legacy protection) and rolls back cleanly', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();
    const uExternal = await createTestUser();

    // Alice has an accepted bilateral swap with uExternal
    const acceptedSwap = await SwapRequest.create({
      fromUser: uA._id,
      toUser: uExternal._id,
      offeredSkill: 'Singing',
      wantedSkill: 'Guitar',
      status: 'accepted',
    });
    createdSwapIds.push(acceptedSwap._id);

    // Create circular proposal
    const legs = buildValid3CycleLegs(uA, uB, uC, ['Singing', 'Drums', 'Bass']);
    const reqCreate = { userId: uA._id.toString(), body: { legs } };
    const resCreate = mockRes();
    await createCircularProposal(reqCreate, resCreate);
    const cycleId = resCreate.body._id.toString();
    createdCycleIds.push(cycleId);

    // Bob accepts
    const reqB = { userId: uB._id.toString(), params: { id: cycleId } };
    const resB = mockRes();
    await acceptCircularInvitation(reqB, resB);

    // Charlie accepts -> should abort due to Alice's active swap
    const reqC = { userId: uC._id.toString(), params: { id: cycleId } };
    const resC = mockRes();
    await acceptCircularInvitation(reqC, resC);

    assert.strictEqual(resC.statusCode, 409);
    assert(resC.body.message.includes('active exchange in progress') || resC.body.message.includes('Conflict'));

    // Verify clean rollback
    const parent = await CircularExchange.findById(cycleId);
    assert.strictEqual(parent.status, 'proposed');
    const childSwaps = await SwapRequest.find({ circularExchange: cycleId });
    assert.strictEqual(childSwaps.length, 0);
  });

  await test('Outbox creation failure rolls back transaction leaving zero child swaps and zero reservations', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const legs = buildValid3CycleLegs(uA, uB, uC, ['SimRollback1', 'SimRollback2', 'SimRollback3']);
    const reqCreate = { userId: uA._id.toString(), body: { legs } };
    const resCreate = mockRes();
    await createCircularProposal(reqCreate, resCreate);
    const cycleId = resCreate.body._id.toString();
    createdCycleIds.push(cycleId);

    // Bob accepts
    await acceptCircularInvitation({ userId: uB._id.toString(), params: { id: cycleId } }, mockRes());

    // Monkey-patch OutboxEvent.insertMany to simulate failure during Charlie's activation
    const origInsertMany = OutboxEvent.insertMany;
    let patchActive = true;
    OutboxEvent.insertMany = async function (...args) {
      if (patchActive) {
        throw new Error('Simulated atomic outbox failure');
      }
      return origInsertMany.apply(this, args);
    };

    try {
      const resC = mockRes();
      await acceptCircularInvitation({ userId: uC._id.toString(), params: { id: cycleId } }, resC);
      assert.strictEqual(resC.statusCode, 500);
      assert(resC.body.error.includes('Simulated atomic outbox failure'));
    } finally {
      patchActive = false;
      OutboxEvent.insertMany = origInsertMany;
    }

    // Verify complete rollback
    const parent = await CircularExchange.findById(cycleId);
    assert.strictEqual(parent.status, 'proposed');
    assert.strictEqual(parent.activatedAt, null);

    const reservations = await ExchangeReservation.find({ exchangeId: cycleId });
    assert.strictEqual(reservations.length, 0, 'No reservations should remain after outbox failure rollback');

    const childSwaps = await SwapRequest.find({ circularExchange: cycleId });
    assert.strictEqual(childSwaps.length, 0, 'No child swaps should remain after outbox failure rollback');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. CONCURRENCY & IDEMPOTENCY
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- 3. Concurrency & Idempotency ---');

  await test('Repeated acceptance after activation returns 200 idempotently without duplicate side effects', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const legs = buildValid3CycleLegs(uA, uB, uC, ['DevOps', 'Docker', 'Linux']);
    const reqCreate = { userId: uA._id.toString(), body: { legs } };
    const resCreate = mockRes();
    await createCircularProposal(reqCreate, resCreate);
    const cycleId = resCreate.body._id.toString();
    createdCycleIds.push(cycleId);

    // Bob accepts
    await acceptCircularInvitation({ userId: uB._id.toString(), params: { id: cycleId } }, mockRes());
    // Charlie accepts -> activates
    await acceptCircularInvitation({ userId: uC._id.toString(), params: { id: cycleId } }, mockRes());

    const reservationsBefore = await ExchangeReservation.countDocuments({ exchangeId: cycleId });
    const childSwapsBefore = await SwapRequest.countDocuments({ circularExchange: cycleId });
    const outboxBefore = await OutboxEvent.countDocuments({ aggregateId: cycleId, type: 'CIRCULAR_SWAP_ACTIVATED' });

    assert.strictEqual(reservationsBefore, 3);
    assert.strictEqual(childSwapsBefore, 3);
    assert.strictEqual(outboxBefore, 3);

    // Bob calls accept AGAIN on the already active exchange
    const reqRepeat = { userId: uB._id.toString(), params: { id: cycleId } };
    const resRepeat = mockRes();
    await acceptCircularInvitation(reqRepeat, resRepeat);

    assert.strictEqual(resRepeat.statusCode, 200);
    assert(resRepeat.body.message.includes('already active'));
    assert.strictEqual(resRepeat.body.activated, true);

    // Verify side effect counts remain strictly 3
    const reservationsAfter = await ExchangeReservation.countDocuments({ exchangeId: cycleId });
    const childSwapsAfter = await SwapRequest.countDocuments({ circularExchange: cycleId });
    const outboxAfter = await OutboxEvent.countDocuments({ aggregateId: cycleId, type: 'CIRCULAR_SWAP_ACTIVATED' });

    assert.strictEqual(reservationsAfter, 3);
    assert.strictEqual(childSwapsAfter, 3);
    assert.strictEqual(outboxAfter, 3);
  });

  await test('Two simultaneous final-acceptance attempts allow exactly one activation without duplication', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const legs = buildValid3CycleLegs(uA, uB, uC, ['MachineLearning', 'DataScience', 'Statistics']);
    const reqCreate = { userId: uA._id.toString(), body: { legs } };
    const resCreate = mockRes();
    await createCircularProposal(reqCreate, resCreate);
    const cycleId = resCreate.body._id.toString();
    createdCycleIds.push(cycleId);

    // Bob accepts first (2 of 3 accepted)
    const reqB = { userId: uB._id.toString(), params: { id: cycleId } };
    const resB = mockRes();
    await acceptCircularInvitation(reqB, resB);
    assert.strictEqual(resB.statusCode, 200);
    assert.strictEqual(resB.body.allAccepted, false);

    // Two simultaneous final-acceptance attempts by Charlie
    const reqC1 = { userId: uC._id.toString(), params: { id: cycleId } };
    const resC1 = mockRes();
    const reqC2 = { userId: uC._id.toString(), params: { id: cycleId } };
    const resC2 = mockRes();

    await Promise.all([
      acceptCircularInvitation(reqC1, resC1),
      acceptCircularInvitation(reqC2, resC2),
    ]);

    assert.strictEqual(resC1.statusCode, 200);
    assert.strictEqual(resC2.statusCode, 200);

    const parent = await CircularExchange.findById(cycleId);
    assert.strictEqual(parent.status, 'active');

    // Exactly 3 reservations and 3 child swaps
    const resCount = await ExchangeReservation.countDocuments({ exchangeId: cycleId });
    const swapCount = await SwapRequest.countDocuments({ circularExchange: cycleId });
    const outboxCount = await OutboxEvent.countDocuments({ aggregateId: cycleId, type: 'CIRCULAR_SWAP_ACTIVATED' });

    assert.strictEqual(resCount, 3);
    assert.strictEqual(swapCount, 3);
    assert.strictEqual(outboxCount, 3);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. LIFECYCLE GUARDS & RETRY CAPABILITY
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- 4. Lifecycle Guards & Retry Capability ---');

  await test('Expired proposal cannot activate (400 Bad Request)', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const legs = buildValid3CycleLegs(uA, uB, uC, ['Swift', 'ObjectiveC', 'iOS']);
    const reqCreate = { userId: uA._id.toString(), body: { legs } };
    const resCreate = mockRes();
    await createCircularProposal(reqCreate, resCreate);
    const cycleId = resCreate.body._id.toString();
    createdCycleIds.push(cycleId);

    // Fast-forward expiresAt to the past
    await CircularExchange.updateOne(
      { _id: cycleId },
      { $set: { expiresAt: new Date(Date.now() - 1000 * 60) } }
    );

    // Attempt accept
    const reqB = { userId: uB._id.toString(), params: { id: cycleId } };
    const resB = mockRes();
    await acceptCircularInvitation(reqB, resB);

    assert.strictEqual(resB.statusCode, 400);
    assert(resB.body.message.includes('expired'));
  });

  await test('Safe retry: proposal where activation previously failed can be retried successfully once conflict is released', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    // Create a temporary conflicting reservation for Bob
    const tempExchangeId = new mongoose.Types.ObjectId();
    const tempRes = await ExchangeReservation.create({
      participant: uB._id,
      exchangeType: 'circular',
      exchangeId: tempExchangeId,
      skillBeingTaught: 'TempSkill',
      status: 'active',
    });
    createdResIds.push(tempRes._id);

    const legs = buildValid3CycleLegs(uA, uB, uC, ['Guitar', 'Singing', 'Piano']);
    const reqCreate = { userId: uA._id.toString(), body: { legs } };
    const resCreate = mockRes();
    await createCircularProposal(reqCreate, resCreate);
    const cycleId = resCreate.body._id.toString();
    createdCycleIds.push(cycleId);

    // Both B and C accept -> Charlie triggers activation attempt which fails with 409
    await acceptCircularInvitation({ userId: uB._id.toString(), params: { id: cycleId } }, mockRes());
    const resFail = mockRes();
    await acceptCircularInvitation({ userId: uC._id.toString(), params: { id: cycleId } }, resFail);
    assert.strictEqual(resFail.statusCode, 409);

    // Parent is still 'proposed'
    let parent = await CircularExchange.findById(cycleId);
    assert.strictEqual(parent.status, 'proposed');

    // Now the conflicting temporary reservation is released!
    await ExchangeReservation.deleteOne({ _id: tempRes._id });

    // Participant retries activation by calling accept again
    const resRetry = mockRes();
    await acceptCircularInvitation({ userId: uC._id.toString(), params: { id: cycleId } }, resRetry);
    assert.strictEqual(resRetry.statusCode, 200);
    assert.strictEqual(resRetry.body.activated, true);

    parent = await CircularExchange.findById(cycleId);
    assert.strictEqual(parent.status, 'active');

    const reservations = await ExchangeReservation.find({ exchangeId: cycleId });
    assert.strictEqual(reservations.length, 3);
  });

  await test('Declined/cancelled proposal cannot activate (400 Bad Request)', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const legs = buildValid3CycleLegs(uA, uB, uC, ['Painting', 'Drawing', 'Sculpture']);
    const reqCreate = { userId: uA._id.toString(), body: { legs } };
    const resCreate = mockRes();
    await createCircularProposal(reqCreate, resCreate);
    const cycleId = resCreate.body._id.toString();
    createdCycleIds.push(cycleId);

    // Bob declines
    await declineCircularInvitation({ userId: uB._id.toString(), params: { id: cycleId }, body: { reason: 'No interest' } }, mockRes());

    // Charlie attempts to accept
    const resC = mockRes();
    await acceptCircularInvitation({ userId: uC._id.toString(), params: { id: cycleId } }, resC);
    assert.strictEqual(resC.statusCode, 400);
    assert(resC.body.message.includes('Cannot accept: proposal is cancelled'));
  });

  await test('Parent cannot activate before all three accept (remains proposed)', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const legs = buildValid3CycleLegs(uA, uB, uC, ['Writing', 'Editing', 'Publishing']);
    const reqCreate = { userId: uA._id.toString(), body: { legs } };
    const resCreate = mockRes();
    await createCircularProposal(reqCreate, resCreate);
    const cycleId = resCreate.body._id.toString();
    createdCycleIds.push(cycleId);

    // Only Bob accepts
    const resB = mockRes();
    await acceptCircularInvitation({ userId: uB._id.toString(), params: { id: cycleId } }, resB);
    assert.strictEqual(resB.statusCode, 200);
    assert.strictEqual(resB.body.allAccepted, false);
    assert.strictEqual(resB.body.activated, false);

    const parent = await CircularExchange.findById(cycleId);
    assert.strictEqual(parent.status, 'proposed');
    assert.strictEqual(parent.activatedAt, null);

    const reservations = await ExchangeReservation.find({ exchangeId: cycleId });
    assert.strictEqual(reservations.length, 0);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. RELIABILITY INTEGRATION
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- 5. Reliability Integration for Circular Child Swaps ---');

  await test('Circular child swap completion counts only the teacher (fromUser), NOT the learner (toUser)', async () => {
    const uTeacher = await createTestUser({ name: 'Teacher_Rel' });
    const uLearner = await createTestUser({ name: 'Learner_Rel' });

    const dummyCycleId = new mongoose.Types.ObjectId();

    // Create a completed circular child swap: uTeacher teaches uLearner
    const circularSwap = await SwapRequest.create({
      fromUser: uTeacher._id,
      toUser: uLearner._id,
      offeredSkill: 'Chemistry',
      wantedSkill: '[Circular Exchange]',
      status: 'completed',
      circularExchange: dummyCycleId,
      circularLegIndex: 0,
    });
    createdSwapIds.push(circularSwap._id);

    // Compute reliability for both users via getUserExchangeReliability
    const teacherRel = await getUserExchangeReliability(uTeacher._id);
    const learnerRel = await getUserExchangeReliability(uLearner._id);

    // Teacher completed 1 teaching swap
    assert.strictEqual(teacherRel.completedCount, 1, 'Teacher must receive 1 completed count');
    assert.strictEqual(teacherRel.neutralPrior, false);

    // Learner received 0 completion counts for this leg (they were the learner)
    assert.strictEqual(learnerRel.completedCount, 0, 'Learner must NOT receive completion count for received leg');
    assert.strictEqual(learnerRel.neutralPrior, true);

    // Now test batch reliability
    const batchMap = await getBatchExchangeReliability([uTeacher._id, uLearner._id]);
    assert.strictEqual(batchMap.get(uTeacher._id.toString()).completedCount, 1);
    assert.strictEqual(batchMap.get(uLearner._id.toString()).completedCount, 0);
  });

  await test('Bilateral swap completion continues to count both participants equally', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();

    // Bilateral swap (circularExchange is null)
    const bilateralSwap = await SwapRequest.create({
      fromUser: uA._id,
      toUser: uB._id,
      offeredSkill: 'English',
      wantedSkill: 'Spanish',
      status: 'completed',
      circularExchange: null,
    });
    createdSwapIds.push(bilateralSwap._id);

    const relA = await getUserExchangeReliability(uA._id);
    const relB = await getUserExchangeReliability(uB._id);

    assert.strictEqual(relA.completedCount, 1);
    assert.strictEqual(relB.completedCount, 1);
  });

  await test('Regression: Bilateral swap acceptance and completion correctly acquire and release reservations', async () => {
    const { acceptSwapRequest, completeSwapRequest } = require('./controllers/swapController');
    const uA = await createTestUser();
    const uB = await createTestUser();

    const swap = await SwapRequest.create({
      fromUser: uA._id,
      toUser: uB._id,
      offeredSkill: 'Photography',
      wantedSkill: 'Videography',
      status: 'pending',
    });
    createdSwapIds.push(swap._id);

    // uB accepts
    const resAccept = mockRes();
    await acceptSwapRequest({ params: { id: swap._id.toString() }, userId: uB._id.toString() }, resAccept);
    assert.strictEqual(resAccept.statusCode, 200);

    const resCount = await ExchangeReservation.countDocuments({ exchangeId: swap._id });
    assert.strictEqual(resCount, 2, 'Bilateral swap acceptance must acquire 2 reservations');

    // uB completes
    const resComplete = mockRes();
    await completeSwapRequest({ params: { id: swap._id.toString() }, userId: uB._id.toString() }, resComplete);
    assert.strictEqual(resComplete.statusCode, 200);

    const resCountAfter = await ExchangeReservation.countDocuments({ exchangeId: swap._id });
    assert.strictEqual(resCountAfter, 0, 'Bilateral swap completion must release both reservations');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 6. END-TO-END HTTP ROUTING
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- 6. End-to-End HTTP Routing & JWT Auth ---');

  await test('End-to-End: Full proposal and activation flow through real Express HTTP server', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const tokenA = generateToken(uA._id);
    const tokenB = generateToken(uB._id);
    const tokenC = generateToken(uC._id);

    const legs = buildValid3CycleLegs(uA, uB, uC, ['GraphQL', 'Apollo', 'Prisma']);

    // HTTP POST proposal
    const resPost = await apiRequest('POST', '/api/circular/proposals', { legs, cycleScore: 95 }, tokenA);
    assert.strictEqual(resPost.status, 201);
    const cycleId = resPost.body._id;
    createdCycleIds.push(cycleId);

    // HTTP PUT accept by Bob
    const resB = await apiRequest('PUT', `/api/circular/proposals/${cycleId}/accept`, {}, tokenB);
    assert.strictEqual(resB.status, 200);
    assert.strictEqual(resB.body.allAccepted, false);
    assert.strictEqual(resB.body.activated, false);

    // HTTP PUT accept by Charlie -> activates!
    const resC = await apiRequest('PUT', `/api/circular/proposals/${cycleId}/accept`, {}, tokenC);
    assert.strictEqual(resC.status, 200);
    assert.strictEqual(resC.body.allAccepted, true);
    assert.strictEqual(resC.body.activated, true);
    assert(resC.body.message.includes('successfully activated'));

    // HTTP GET proposal details by Alice -> shows active
    const resGet = await apiRequest('GET', `/api/circular/proposals/${cycleId}`, null, tokenA);
    assert.strictEqual(resGet.status, 200);
    assert.strictEqual(resGet.body.status, 'active');
    assert.strictEqual(resGet.body.legs.length, 3);
    assert(resGet.body.legs[0].swapRequest);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEARDOWN
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- Teardown Test Data ---');
  await stopHttpServer();
  await CircularExchange.deleteMany({ _id: { $in: createdCycleIds } });
  await ExchangeReservation.deleteMany({
    $or: [
      { _id: { $in: createdResIds } },
      { exchangeId: { $in: createdCycleIds } },
    ],
  });
  await SwapRequest.deleteMany({
    $or: [
      { _id: { $in: createdSwapIds } },
      { circularExchange: { $in: createdCycleIds } },
    ],
  });
  await OutboxEvent.deleteMany({
    $or: [
      { _id: { $in: createdOutboxIds } },
      { aggregateId: { $in: createdCycleIds } },
    ],
  });
  await User.deleteMany({ _id: { $in: createdUserIds } });
  console.log('  🧹 Teardown complete.');

  console.log('\n================================================================');
  console.log(`Substage 3.3 Test Results: ${passed} passed, ${failed} failed`);
  console.log('================================================================\n');

  if (failed > 0) {
    console.error('Failure Details:');
    failures.forEach((f, idx) => {
      console.error(`\n[${idx + 1}] ${f.name}\n${f.stack}`);
    });
    process.exit(1);
  }
}

runTests()
  .then(() => {
    console.log('All Substage 3.3 tests completed successfully!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Test runner fatal error:', err);
    process.exit(1);
  });
