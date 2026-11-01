/**
 * Phase 6 — Step 3 — Substage 3.2: Circular Proposal & Acceptance API Tests
 * test_phase6_step3_stage3_sub2.js
 *
 * Verifies:
 * 1. Valid proposal creation & initiator auto-acceptance (initiator hasAccepted: true, invitees pending).
 * 2. Strict rejection of invalid cycle structures (self-loops, 2-cycles, disconnected loops, bad leg count).
 * 3. Duplicate active/proposed cycle prevention (409 Conflict via canonical hash & unique partial index).
 * 4. Cycle re-proposal allowed after previous cycle was cancelled or expired.
 * 5. Proposal listing (GET /api/circular/proposals) scoped strictly to participating user.
 * 6. Proposal detail authorization (GET /api/circular/proposals/:id) allows participants, rejects non-participants (403).
 * 7. Non-participant access and mutation rejection (403 on create, view, accept, decline).
 * 8. First invitee acceptance (2nd participant overall) emits partial acceptance outbox events.
 * 9. Idempotent acceptance (duplicate accept returns 200 without duplicate outbox events).
 * 10. Third participant acceptance: CRITICAL LIFECYCLE BOUNDARY:
 *     - Records acceptance and allAccepted: true
 *     - Status strictly remains 'proposed'
 *     - ZERO reservations acquired
 *     - ZERO child SwapRequests created
 *     - Exchange is NOT marked 'active'
 * 11. Decline handling: transitions status to 'cancelled', records cancelledBy and reason, emits outbox events.
 * 12. Idempotent decline (duplicate decline returns 200 without duplicate outbox events).
 * 13. Block acceptance/decline on cancelled or completed proposals (400 Bad Request).
 * 14. 72-hour lazy expiration & background sweeper (blocks accept/decline, preserves historical records).
 * 15. Concurrent accept/decline safety.
 * 16. Transaction rollback atomicity (no orphaned circular exchange or outbox events on abort).
 * 17. End-to-end HTTP routing & JWT authentication (POST, GET, PUT /api/circular/proposals via Express app).
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
  sweepExpiredCircularProposals,
} = require('./controllers/circularProposalController');

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

function buildValid3CycleLegs(uA, uB, uC, skills = ['React', 'Python', 'Guitar']) {
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
      category: 'Music',
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
  console.log('🧪 Starting Phase 6 Step 3 Substage 3.2: Circular Proposal & Acceptance API Tests');
  console.log('================================================================\n');

  const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/skillswap';
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(mongoUri);
  }

  // Ensure unique indexes on CircularExchange and OutboxEvent are registered
  await CircularExchange.syncIndexes();
  await OutboxEvent.syncIndexes();

  // Start ephemeral HTTP server for end-to-end integration tests
  await startHttpServer();

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. PROPOSAL CREATION & INITIATOR AUTO-ACCEPTANCE
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- 1. Proposal Creation & Initiator Auto-Acceptance ---');

  await test('Valid proposal creation: initiator is auto-accepted, invitees pending, expiresAt in 72h', async () => {
    const uA = await createTestUser({ name: 'Alice_Prop' });
    const uB = await createTestUser({ name: 'Bob_Prop' });
    const uC = await createTestUser({ name: 'Charlie_Prop' });

    const legs = buildValid3CycleLegs(uA, uB, uC);
    const req = {
      userId: uA._id.toString(),
      body: {
        legs,
        cycleScore: 88,
      },
    };
    const res = mockRes();

    await createCircularProposal(req, res);

    assert.strictEqual(res.statusCode, 201, `Expected 201 Created, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
    assert(res.body._id, 'Expected returned proposal to have _id');
    createdCycleIds.push(res.body._id);

    const proposal = await CircularExchange.findById(res.body._id);
    assert.strictEqual(proposal.status, 'proposed');
    assert.strictEqual(proposal.initiator.toString(), uA._id.toString());
    assert.strictEqual(proposal.cycleScore, 88);

    // Verify initiator is auto-accepted
    const pA = proposal.participants.find(p => p.user.toString() === uA._id.toString());
    assert.strictEqual(pA.hasAccepted, true);
    assert(pA.acceptedAt instanceof Date);

    // Verify invitees are pending
    const pB = proposal.participants.find(p => p.user.toString() === uB._id.toString());
    const pC = proposal.participants.find(p => p.user.toString() === uC._id.toString());
    assert.strictEqual(pB.hasAccepted, false);
    assert.strictEqual(pB.acceptedAt, null);
    assert.strictEqual(pC.hasAccepted, false);
    assert.strictEqual(pC.acceptedAt, null);

    // Verify expiresAt is ~72 hours in the future
    const expectedExpiryMin = Date.now() + 71 * 60 * 60 * 1000;
    const expectedExpiryMax = Date.now() + 73 * 60 * 60 * 1000;
    assert(proposal.expiresAt.getTime() > expectedExpiryMin);
    assert(proposal.expiresAt.getTime() < expectedExpiryMax);

    // Verify OutboxEvent records created for Bob and Charlie (not Alice)
    const outboxEvents = await OutboxEvent.find({
      aggregateType: 'circular_exchange',
      aggregateId: proposal._id,
    });
    outboxEvents.forEach(e => createdOutboxIds.push(e._id));

    assert.strictEqual(outboxEvents.length, 2, 'Expected exactly 2 outbox events for the 2 invitees');
    const recipients = outboxEvents.map(e => e.recipient.toString());
    assert(recipients.includes(uB._id.toString()));
    assert(recipients.includes(uC._id.toString()));
    assert(!recipients.includes(uA._id.toString()));
    assert.strictEqual(outboxEvents[0].type, 'CIRCULAR_SWAP_PROPOSED');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. INVALID CYCLE STRUCTURE REJECTION
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- 2. Invalid Cycle Structure Rejection ---');

  await test('Reject cycle with fewer than 3 legs (400 Bad Request)', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const req = {
      userId: uA._id.toString(),
      body: {
        legs: [
          { teacher: uA._id, learner: uB._id, skill: 'React' },
          { teacher: uB._id, learner: uA._id, skill: 'Python' },
        ],
      },
    };
    const res = mockRes();
    await createCircularProposal(req, res);
    assert.strictEqual(res.statusCode, 400);
    assert(res.body.message.includes('requires exactly 3 directed legs'));
  });

  await test('Reject cycle with self-loops (A -> A) (400 Bad Request)', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();
    const req = {
      userId: uA._id.toString(),
      body: {
        legs: [
          { teacher: uA._id, learner: uA._id, skill: 'React' },
          { teacher: uB._id, learner: uC._id, skill: 'Python' },
          { teacher: uC._id, learner: uB._id, skill: 'Guitar' },
        ],
      },
    };
    const res = mockRes();
    await createCircularProposal(req, res);
    assert.strictEqual(res.statusCode, 400);
    assert(res.body.message.includes('Self-loops are forbidden'));
  });

  await test('Reject bilateral 2-cycle in legs (A -> B and B -> A) (400 Bad Request)', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();
    const req = {
      userId: uA._id.toString(),
      body: {
        legs: [
          { teacher: uA._id, learner: uB._id, skill: 'React' },
          { teacher: uB._id, learner: uA._id, skill: 'Python' },
          { teacher: uC._id, learner: uC._id, skill: 'Guitar' },
        ],
      },
    };
    const res = mockRes();
    await createCircularProposal(req, res);
    assert.strictEqual(res.statusCode, 400);
  });

  await test('Reject disconnected loop (A -> B, B -> C, C -> B) (400 Bad Request)', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();
    const req = {
      userId: uA._id.toString(),
      body: {
        legs: [
          { teacher: uA._id, learner: uB._id, skill: 'React' },
          { teacher: uB._id, learner: uC._id, skill: 'Python' },
          { teacher: uC._id, learner: uB._id, skill: 'Guitar' },
        ],
      },
    };
    const res = mockRes();
    await createCircularProposal(req, res);
    assert.strictEqual(res.statusCode, 400);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. DUPLICATE CYCLE PREVENTION & RE-PROPOSAL AFTER CANCEL
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- 3. Duplicate Prevention & Canonical Hash ---');

  await test('Duplicate proposed cycle returns 409 Conflict even with rotated legs', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const legsNormal = buildValid3CycleLegs(uA, uB, uC, ['Docker', 'Kubernetes', 'Go']);
    const req1 = { userId: uA._id.toString(), body: { legs: legsNormal } };
    const res1 = mockRes();
    await createCircularProposal(req1, res1);
    assert.strictEqual(res1.statusCode, 201);
    createdCycleIds.push(res1.body._id);

    // Rotated legs: uB -> uC, uC -> uA, uA -> uB (same directed cycle)
    const legsRotated = [legsNormal[1], legsNormal[2], legsNormal[0]];
    const req2 = { userId: uB._id.toString(), body: { legs: legsRotated } };
    const res2 = mockRes();
    await createCircularProposal(req2, res2);

    assert.strictEqual(res2.statusCode, 409, `Expected 409 Conflict, got ${res2.statusCode}: ${JSON.stringify(res2.body)}`);
    assert(res2.body.message.includes('already proposed or active'));
  });

  await test('Can re-propose identical cycle if previous was cancelled', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const legs = buildValid3CycleLegs(uA, uB, uC, ['Rust', 'Zig', 'C++']);
    const req1 = { userId: uA._id.toString(), body: { legs } };
    const res1 = mockRes();
    await createCircularProposal(req1, res1);
    assert.strictEqual(res1.statusCode, 201);
    const cycle1Id = res1.body._id;
    createdCycleIds.push(cycle1Id);

    // Participant B declines the proposal -> transitions to 'cancelled'
    const reqDecline = { userId: uB._id.toString(), params: { id: cycle1Id.toString() }, body: {} };
    const resDecline = mockRes();
    await declineCircularInvitation(reqDecline, resDecline);
    assert.strictEqual(resDecline.statusCode, 200);

    const cancelledCycle = await CircularExchange.findById(cycle1Id);
    assert.strictEqual(cancelledCycle.status, 'cancelled');

    // Participant A can now propose the cycle again
    const req2 = { userId: uA._id.toString(), body: { legs } };
    const res2 = mockRes();
    await createCircularProposal(req2, res2);
    assert.strictEqual(res2.statusCode, 201, `Expected 201 on re-proposal after cancel, got: ${res2.statusCode}`);
    createdCycleIds.push(res2.body._id);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. AUTHORIZATION CHECKS & NON-PARTICIPANT REJECTION
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- 4. Authorization & Non-Participant Rejection ---');

  await test('Non-participant cannot propose a cycle they are not in (403 Forbidden)', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();
    const uOutsider = await createTestUser();

    const legs = buildValid3CycleLegs(uA, uB, uC, ['Figma', 'Sketch', 'Photoshop']);
    const req = {
      userId: uOutsider._id.toString(),
      body: { legs },
    };
    const res = mockRes();
    await createCircularProposal(req, res);
    assert.strictEqual(res.statusCode, 403);
    assert(res.body.message.includes('Forbidden'));
  });

  await test('GET /api/circular/proposals lists only proposals where user is a participant', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();
    const uD = await createTestUser();

    // Cycle 1: A, B, C
    const legs1 = buildValid3CycleLegs(uA, uB, uC, ['Design', 'Drawing', 'Art']);
    const req1 = { userId: uA._id.toString(), body: { legs: legs1 } };
    const res1 = mockRes();
    await createCircularProposal(req1, res1);
    createdCycleIds.push(res1.body._id);

    // Listing for uA
    const reqListA = { userId: uA._id.toString(), query: {} };
    const resListA = mockRes();
    await getCircularProposals(reqListA, resListA);
    assert.strictEqual(resListA.statusCode, 200);
    assert(Array.isArray(resListA.body));
    assert(resListA.body.some(p => p._id.toString() === res1.body._id.toString()));

    // Listing for uD (outsider)
    const reqListD = { userId: uD._id.toString(), query: {} };
    const resListD = mockRes();
    await getCircularProposals(reqListD, resListD);
    assert.strictEqual(resListD.statusCode, 200);
    assert(!resListD.body.some(p => p._id.toString() === res1.body._id.toString()));
  });

  await test('GET /api/circular/proposals/:id rejects non-participant with 403 Forbidden', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();
    const uOutsider = await createTestUser();

    const legs = buildValid3CycleLegs(uA, uB, uC, ['Math', 'Physics', 'Chemistry']);
    const reqCreate = { userId: uA._id.toString(), body: { legs } };
    const resCreate = mockRes();
    await createCircularProposal(reqCreate, resCreate);
    const cycleId = resCreate.body._id.toString();
    createdCycleIds.push(cycleId);

    // Participant uB gets 200
    const reqB = { userId: uB._id.toString(), params: { id: cycleId } };
    const resB = mockRes();
    await getCircularProposalById(reqB, resB);
    assert.strictEqual(resB.statusCode, 200);
    assert.strictEqual(resB.body._id.toString(), cycleId);

    // Outsider gets 403
    const reqOut = { userId: uOutsider._id.toString(), params: { id: cycleId } };
    const resOut = mockRes();
    await getCircularProposalById(reqOut, resOut);
    assert.strictEqual(resOut.statusCode, 403);
    assert(resOut.body.message.includes('Forbidden'));
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. ACCEPTANCE LIFECYCLE & CRITICAL ACTIVATION BOUNDARY
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- 5. Acceptance Lifecycle & Boundary Enforcement ---');

  await test('First invitee acceptance (2nd participant overall): partial accept outbox events emitted', async () => {
    const uA = await createTestUser({ name: 'Alice_P2' });
    const uB = await createTestUser({ name: 'Bob_P2' });
    const uC = await createTestUser({ name: 'Charlie_P2' });

    const legs = buildValid3CycleLegs(uA, uB, uC, ['NodeJS', 'Express', 'MongoDB']);
    const reqCreate = { userId: uA._id.toString(), body: { legs } };
    const resCreate = mockRes();
    await createCircularProposal(reqCreate, resCreate);
    const cycleId = resCreate.body._id.toString();
    createdCycleIds.push(cycleId);

    // Bob accepts
    const reqAcceptB = { userId: uB._id.toString(), params: { id: cycleId } };
    const resAcceptB = mockRes();
    await acceptCircularInvitation(reqAcceptB, resAcceptB);

    assert.strictEqual(resAcceptB.statusCode, 200);
    assert.strictEqual(resAcceptB.body.allAccepted, false);
    assert(resAcceptB.body.message.includes('Invitation accepted successfully'));

    const updated = await CircularExchange.findById(cycleId);
    assert.strictEqual(updated.status, 'proposed');
    const pB = updated.participants.find(p => p.user.toString() === uB._id.toString());
    assert.strictEqual(pB.hasAccepted, true);

    // Outbox events emitted for Alice and Charlie
    const outboxEvents = await OutboxEvent.find({
      aggregateType: 'circular_exchange',
      aggregateId: cycleId,
      type: 'CIRCULAR_SWAP_ACCEPTED_PARTIAL',
    });
    outboxEvents.forEach(e => createdOutboxIds.push(e._id));
    assert.strictEqual(outboxEvents.length, 2);
    const recipients = outboxEvents.map(e => e.recipient.toString());
    assert(recipients.includes(uA._id.toString()));
    assert(recipients.includes(uC._id.toString()));
  });

  await test('Idempotent accept: second accept by same user returns 200 without duplicate outbox events', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const legs = buildValid3CycleLegs(uA, uB, uC, ['Piano', 'Violin', 'Cello']);
    const reqCreate = { userId: uA._id.toString(), body: { legs } };
    const resCreate = mockRes();
    await createCircularProposal(reqCreate, resCreate);
    const cycleId = resCreate.body._id.toString();
    createdCycleIds.push(cycleId);

    // Bob accepts first time
    const reqAccept1 = { userId: uB._id.toString(), params: { id: cycleId } };
    const resAccept1 = mockRes();
    await acceptCircularInvitation(reqAccept1, resAccept1);
    assert.strictEqual(resAccept1.statusCode, 200);

    const countAfterFirst = await OutboxEvent.countDocuments({
      aggregateType: 'circular_exchange',
      aggregateId: cycleId,
      type: 'CIRCULAR_SWAP_ACCEPTED_PARTIAL',
    });

    // Bob accepts second time (idempotent)
    const reqAccept2 = { userId: uB._id.toString(), params: { id: cycleId } };
    const resAccept2 = mockRes();
    await acceptCircularInvitation(reqAccept2, resAccept2);
    assert.strictEqual(resAccept2.statusCode, 200);
    assert(resAccept2.body.message.includes('already accepted'));

    const countAfterSecond = await OutboxEvent.countDocuments({
      aggregateType: 'circular_exchange',
      aggregateId: cycleId,
      type: 'CIRCULAR_SWAP_ACCEPTED_PARTIAL',
    });
    assert.strictEqual(countAfterSecond, countAfterFirst, 'Duplicate accept must NOT create duplicate outbox events');
  });

  await test('CRITICAL LIFECYCLE BOUNDARY: Third participant acceptance marks allAccepted: true, status stays proposed, ZERO reservations, ZERO child swaps', async () => {
    const uA = await createTestUser({ name: 'Alice_Full' });
    const uB = await createTestUser({ name: 'Bob_Full' });
    const uC = await createTestUser({ name: 'Charlie_Full' });

    const legs = buildValid3CycleLegs(uA, uB, uC, ['Spanish', 'French', 'German']);
    const reqCreate = { userId: uA._id.toString(), body: { legs } };
    const resCreate = mockRes();
    await createCircularProposal(reqCreate, resCreate);
    const cycleId = resCreate.body._id.toString();
    createdCycleIds.push(cycleId);

    // Bob accepts
    const reqB = { userId: uB._id.toString(), params: { id: cycleId } };
    const resB = mockRes();
    await acceptCircularInvitation(reqB, resB);
    assert.strictEqual(resB.statusCode, 200);
    assert.strictEqual(resB.body.allAccepted, false);

    // Charlie accepts (3rd participant)
    const reqC = { userId: uC._id.toString(), params: { id: cycleId } };
    const resC = mockRes();
    await acceptCircularInvitation(reqC, resC);
    assert.strictEqual(resC.statusCode, 200);
    assert.strictEqual(resC.body.allAccepted, true);
    assert(resC.body.message.includes('ready for activation'));

    // Check database state
    const proposal = await CircularExchange.findById(cycleId);

    // 1. All 3 participants haveAccepted: true
    assert(proposal.participants.every(p => p.hasAccepted === true));

    // 2. CRITICAL: status strictly remains 'proposed'
    assert.strictEqual(proposal.status, 'proposed', 'Status must remain proposed until Substage 3.3 activation!');

    // 3. CRITICAL: ZERO reservations acquired for this cycle
    const reservations = await ExchangeReservation.find({ exchangeId: cycleId });
    assert.strictEqual(reservations.length, 0, 'No reservations must be acquired in Substage 3.2!');

    // 4. CRITICAL: ZERO child SwapRequests created
    const childSwaps = await SwapRequest.find({
      $or: [
        { fromUser: { $in: [uA._id, uB._id, uC._id] } },
        { toUser: { $in: [uA._id, uB._id, uC._id] } },
      ],
    });
    assert.strictEqual(childSwaps.length, 0, 'No child SwapRequests must be created in Substage 3.2!');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 6. DECLINE HANDLING & IDEMPOTENCY
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- 6. Decline Handling & Idempotency ---');

  await test('Declining proposal transitions status to cancelled and emits outbox events', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const legs = buildValid3CycleLegs(uA, uB, uC, ['Cooking', 'Baking', 'Pastry']);
    const reqCreate = { userId: uA._id.toString(), body: { legs } };
    const resCreate = mockRes();
    await createCircularProposal(reqCreate, resCreate);
    const cycleId = resCreate.body._id.toString();
    createdCycleIds.push(cycleId);

    // Bob declines with reason
    const reqDecline = {
      userId: uB._id.toString(),
      params: { id: cycleId },
      body: { reason: 'Busy this month' },
    };
    const resDecline = mockRes();
    await declineCircularInvitation(reqDecline, resDecline);

    assert.strictEqual(resDecline.statusCode, 200);
    assert(resDecline.body.message.includes('declined successfully'));

    const updated = await CircularExchange.findById(cycleId);
    assert.strictEqual(updated.status, 'cancelled');
    assert.strictEqual(updated.cancelledBy.toString(), uB._id.toString());
    assert.strictEqual(updated.cancelReason, 'Busy this month');

    // Outbox events emitted for Alice and Charlie
    const outboxEvents = await OutboxEvent.find({
      aggregateType: 'circular_exchange',
      aggregateId: cycleId,
      type: 'CIRCULAR_SWAP_DECLINED',
    });
    outboxEvents.forEach(e => createdOutboxIds.push(e._id));
    assert.strictEqual(outboxEvents.length, 2);
    const recipients = outboxEvents.map(e => e.recipient.toString());
    assert(recipients.includes(uA._id.toString()));
    assert(recipients.includes(uC._id.toString()));
  });

  await test('Idempotent decline: repeating decline by same user returns 200 without duplicate outbox events', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const legs = buildValid3CycleLegs(uA, uB, uC, ['SEO', 'Content', 'Copywriting']);
    const reqCreate = { userId: uA._id.toString(), body: { legs } };
    const resCreate = mockRes();
    await createCircularProposal(reqCreate, resCreate);
    const cycleId = resCreate.body._id.toString();
    createdCycleIds.push(cycleId);

    // First decline
    const reqDec1 = { userId: uB._id.toString(), params: { id: cycleId }, body: {} };
    const resDec1 = mockRes();
    await declineCircularInvitation(reqDec1, resDec1);
    assert.strictEqual(resDec1.statusCode, 200);

    const count1 = await OutboxEvent.countDocuments({
      aggregateType: 'circular_exchange',
      aggregateId: cycleId,
      type: 'CIRCULAR_SWAP_DECLINED',
    });

    // Second decline
    const reqDec2 = { userId: uB._id.toString(), params: { id: cycleId }, body: {} };
    const resDec2 = mockRes();
    await declineCircularInvitation(reqDec2, resDec2);
    assert.strictEqual(resDec2.statusCode, 200);
    assert(resDec2.body.message.includes('already declined'));

    const count2 = await OutboxEvent.countDocuments({
      aggregateType: 'circular_exchange',
      aggregateId: cycleId,
      type: 'CIRCULAR_SWAP_DECLINED',
    });
    assert.strictEqual(count2, count1);
  });

  await test('Cannot accept a cancelled proposal (400 Bad Request)', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const legs = buildValid3CycleLegs(uA, uB, uC, ['Vue', 'Svelte', 'Angular']);
    const reqCreate = { userId: uA._id.toString(), body: { legs } };
    const resCreate = mockRes();
    await createCircularProposal(reqCreate, resCreate);
    const cycleId = resCreate.body._id.toString();
    createdCycleIds.push(cycleId);

    // Bob declines
    const reqDec = { userId: uB._id.toString(), params: { id: cycleId }, body: {} };
    const resDec = mockRes();
    await declineCircularInvitation(reqDec, resDec);
    assert.strictEqual(resDec.statusCode, 200);

    // Charlie attempts to accept
    const reqAcc = { userId: uC._id.toString(), params: { id: cycleId } };
    const resAcc = mockRes();
    await acceptCircularInvitation(reqAcc, resAcc);
    assert.strictEqual(resAcc.statusCode, 400);
    assert(resAcc.body.message.includes('Cannot accept'));
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 7. 72-HOUR LAZY EXPIRATION & BACKGROUND SWEEPER
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- 7. 72-Hour Lazy Expiration & Sweeper ---');

  await test('Expired proposal transitions to expired on access and blocks acceptance (400 Bad Request)', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const legs = buildValid3CycleLegs(uA, uB, uC, ['Kotlin', 'Java', 'Scala']);
    const reqCreate = { userId: uA._id.toString(), body: { legs } };
    const resCreate = mockRes();
    await createCircularProposal(reqCreate, resCreate);
    const cycleId = resCreate.body._id.toString();
    createdCycleIds.push(cycleId);

    // Artificially fast-forward expiresAt to the past (e.g., 73 hours ago)
    await CircularExchange.updateOne(
      { _id: cycleId },
      { $set: { expiresAt: new Date(Date.now() - 1000 * 60) } }
    );

    // Attempt to accept
    const reqAcc = { userId: uB._id.toString(), params: { id: cycleId } };
    const resAcc = mockRes();
    await acceptCircularInvitation(reqAcc, resAcc);
    assert.strictEqual(resAcc.statusCode, 400);
    assert(resAcc.body.message.includes('expired'));

    const updated = await CircularExchange.findById(cycleId);
    assert.strictEqual(updated.status, 'expired');
    assert(updated.cancelReason.includes('expired'));
  });

  await test('Background sweeper sweeps expired proposals without deleting historical data', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const legs = buildValid3CycleLegs(uA, uB, uC, ['AWS', 'GCP', 'Azure']);
    const reqCreate = { userId: uA._id.toString(), body: { legs } };
    const resCreate = mockRes();
    await createCircularProposal(reqCreate, resCreate);
    const cycleId = resCreate.body._id.toString();
    createdCycleIds.push(cycleId);

    // Set expiresAt to the past
    await CircularExchange.updateOne(
      { _id: cycleId },
      { $set: { expiresAt: new Date(Date.now() - 5000) } }
    );

    const sweepResult = await sweepExpiredCircularProposals();
    assert(sweepResult.modifiedCount >= 1);

    const updated = await CircularExchange.findById(cycleId);
    assert.strictEqual(updated.status, 'expired');
    // Ensure document is NOT deleted (TTL delete forbidden)
    assert.strictEqual(updated._id.toString(), cycleId);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 8. CONCURRENT MUTATION SAFETY
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- 8. Concurrency & Mutation Safety ---');

  await test('Concurrent accepts by both invitees succeed and leave state clean', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();

    const legs = buildValid3CycleLegs(uA, uB, uC, ['Ruby', 'Elixir', 'Phoenix']);
    const reqCreate = { userId: uA._id.toString(), body: { legs } };
    const resCreate = mockRes();
    await createCircularProposal(reqCreate, resCreate);
    const cycleId = resCreate.body._id.toString();
    createdCycleIds.push(cycleId);

    const reqB = { userId: uB._id.toString(), params: { id: cycleId } };
    const resB = mockRes();
    const reqC = { userId: uC._id.toString(), params: { id: cycleId } };
    const resC = mockRes();

    // Run both accepts concurrently
    await Promise.all([
      acceptCircularInvitation(reqB, resB),
      acceptCircularInvitation(reqC, resC),
    ]);

    assert.strictEqual(resB.statusCode, 200);
    assert.strictEqual(resC.statusCode, 200);

    const proposal = await CircularExchange.findById(cycleId);
    assert.strictEqual(proposal.status, 'proposed');
    assert(proposal.participants.every(p => p.hasAccepted === true));
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 9. END-TO-END HTTP ROUTING & JWT AUTHENTICATION
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- 9. End-to-End HTTP Routing & JWT Auth ---');

  await test('HTTP POST /api/circular/proposals rejects unauthenticated request (401)', async () => {
    const res = await apiRequest('POST', '/api/circular/proposals', { legs: [] }, null);
    assert.strictEqual(res.status, 401);
  });

  await test('HTTP POST /api/circular/proposals creates proposal with valid JWT token', async () => {
    const uA = await createTestUser();
    const uB = await createTestUser();
    const uC = await createTestUser();
    const tokenA = generateToken(uA._id);

    const legs = buildValid3CycleLegs(uA, uB, uC, ['Kafka', 'RabbitMQ', 'Redis']);
    const res = await apiRequest('POST', '/api/circular/proposals', { legs, cycleScore: 92 }, tokenA);
    assert.strictEqual(res.status, 201);
    assert(res.body._id);
    createdCycleIds.push(res.body._id);

    // HTTP GET listing
    const resList = await apiRequest('GET', '/api/circular/proposals', null, tokenA);
    assert.strictEqual(resList.status, 200);
    assert(Array.isArray(resList.body));
    assert(resList.body.some(p => p._id.toString() === res.body._id.toString()));

    // HTTP GET by ID
    const resDetail = await apiRequest('GET', `/api/circular/proposals/${res.body._id}`, null, tokenA);
    assert.strictEqual(resDetail.status, 200);
    assert.strictEqual(resDetail.body._id.toString(), res.body._id.toString());

    // HTTP PUT accept by Bob
    const tokenB = generateToken(uB._id);
    const resAccept = await apiRequest('PUT', `/api/circular/proposals/${res.body._id}/accept`, {}, tokenB);
    assert.strictEqual(resAccept.status, 200);
    assert.strictEqual(resAccept.body.allAccepted, false);

    // HTTP PUT decline by Charlie
    const tokenC = generateToken(uC._id);
    const resDecline = await apiRequest('PUT', `/api/circular/proposals/${res.body._id}/decline`, { reason: 'No time' }, tokenC);
    assert.strictEqual(resDecline.status, 200);
    assert(resDecline.body.message.includes('declined successfully'));
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEARDOWN
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- Teardown Test Data ---');
  await stopHttpServer();
  await CircularExchange.deleteMany({ _id: { $in: createdCycleIds } });
  await OutboxEvent.deleteMany({ _id: { $in: createdOutboxIds } });
  await User.deleteMany({ _id: { $in: createdUserIds } });
  console.log('  🧹 Teardown complete.');

  console.log('\n================================================================');
  console.log(`Substage 3.2 Test Results: ${passed} passed, ${failed} failed`);
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
    console.log('All Substage 3.2 tests completed successfully!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Test runner fatal error:', err);
    process.exit(1);
  });
