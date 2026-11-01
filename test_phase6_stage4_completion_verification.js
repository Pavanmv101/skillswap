/**
 * test_phase6_stage4_completion_verification.js
 * Verification suite for F-04 Stage 4: Circular Leg Completion & Finalization UI.
 *
 * Verifies all 10 Stage 4 assertions:
 * 1.  Teacher can mark a scheduled leg completed (`PUT /api/circular/:id/legs/:legIndex/complete`).
 * 2.  Learner cannot confirm completion before teacher marks it completed (400 Bad Request).
 * 3.  Learner confirms completion after teacher completion (`PUT /api/circular/:id/legs/:legIndex/complete/confirm`).
 * 4.  Observer cannot perform completion actions (403 Forbidden).
 * 5.  Unscheduled legs cannot be completed (400 Bad Request).
 * 6.  Each of the three legs completes independently.
 * 7.  Completing one or two legs does not complete parent exchange prematurely (status remains 'active').
 * 8.  Third learner confirmation automatically finalizes the parent exchange (`status: 'completed'`).
 * 9.  Duplicate completion/confirmation requests are handled idempotently (HTTP 200).
 * 10. Bilateral swap completion remains completely unaffected.
 */

'use strict';

const { connectTestDb, disconnectTestDb, assertTestDatabaseSafe } = require('./test_db_guard');
require('dotenv').config();
const assert = require('assert');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const http = require('http');
const { app } = require('./server');
const User = require('./models/User');
const SwapRequest = require('./models/SwapRequest');
const CircularExchange = require('./models/CircularExchange');
const OutboxEvent = require('./models/OutboxEvent');
const Notification = require('./models/Notification');

const JWT_SECRET = process.env.JWT_SECRET || 'skillswap-dev-secret-key-2026';

function generateToken(id) {
  return jwt.sign({ id }, JWT_SECRET, { expiresIn: '1h' });
}

async function request(serverUrl, { method, path, token, body }) {
  const url = new URL(path, serverUrl);
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(url.toString(), {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (_) {
    json = text;
  }

  return {
    status: res.status,
    headers: res.headers,
    data: json,
  };
}

async function runStage4Verification() {
  console.log('\n===============================================================');
  console.log('🧪 Starting F-04 Stage 4 Completion Verification Tests');
  console.log('===============================================================\n');

  await connectTestDb();

  const testServer = http.createServer(app);
  const port = 5096;
  await new Promise(resolve => testServer.listen(port, resolve));
  const serverUrl = `http://localhost:${port}`;

  const createdUserIds = [];
  const createdSwapIds = [];
  const createdExchangeIds = [];

  try {
    // 1. Create 4 test users (A, B, C circular participants; D outsider)
    const [userA, userB, userC, userD] = await Promise.all([
      User.create({ name: 'User_A_Teach0_Learn2', email: `user_a_c_${Date.now()}@test.com`, password: 'Password123!' }),
      User.create({ name: 'User_B_Teach1_Learn0', email: `user_b_c_${Date.now()}@test.com`, password: 'Password123!' }),
      User.create({ name: 'User_C_Teach2_Learn1', email: `user_c_c_${Date.now()}@test.com`, password: 'Password123!' }),
      User.create({ name: 'User_D_Outsider', email: `user_d_c_${Date.now()}@test.com`, password: 'Password123!' }),
    ]);
    createdUserIds.push(userA._id, userB._id, userC._id, userD._id);

    const tokenA = generateToken(userA._id.toString());
    const tokenB = generateToken(userB._id.toString());
    const tokenC = generateToken(userC._id.toString());
    const tokenD = generateToken(userD._id.toString());

    // 2. Create active CircularExchange
    const scheduledTime = new Date(Date.now() + 86400000);
    const exchange = await CircularExchange.create({
      initiator: userA._id,
      participants: [
        { user: userA._id, hasAccepted: true },
        { user: userB._id, hasAccepted: true },
        { user: userC._id, hasAccepted: true },
      ],
      legs: [
        { legIndex: 0, teacher: userA._id, learner: userB._id, skill: 'React', status: 'scheduled', scheduledAt: scheduledTime, roomId: `skillswap-circular-leg-0-${Date.now()}` },
        { legIndex: 1, teacher: userB._id, learner: userC._id, skill: 'Node.js', status: 'scheduled', scheduledAt: scheduledTime, roomId: `skillswap-circular-leg-1-${Date.now()}` },
        { legIndex: 2, teacher: userC._id, learner: userA._id, skill: 'UI/UX', status: 'active', scheduledAt: null, roomId: `skillswap-circular-leg-2-${Date.now()}` }, // Leg 2 is unscheduled initially
      ],
      cycleScore: 95,
      expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
      status: 'active',
      canonicalCycleHash: `hash-stage4-${Date.now()}`,
    });
    createdExchangeIds.push(exchange._id);

    // Create child swaps
    const [child0, child1, child2] = await Promise.all([
      SwapRequest.create({
        fromUser: userA._id,
        toUser: userB._id,
        offeredSkill: 'React',
        wantedSkill: '[Circular Exchange]',
        status: 'accepted',
        scheduledAt: scheduledTime,
        roomId: exchange.legs[0].roomId,
        circularExchange: exchange._id,
        circularLegIndex: 0,
      }),
      SwapRequest.create({
        fromUser: userB._id,
        toUser: userC._id,
        offeredSkill: 'Node.js',
        wantedSkill: '[Circular Exchange]',
        status: 'accepted',
        scheduledAt: scheduledTime,
        roomId: exchange.legs[1].roomId,
        circularExchange: exchange._id,
        circularLegIndex: 1,
      }),
      SwapRequest.create({
        fromUser: userC._id,
        toUser: userA._id,
        offeredSkill: 'UI/UX',
        wantedSkill: '[Circular Exchange]',
        status: 'accepted',
        scheduledAt: null,
        roomId: exchange.legs[2].roomId,
        circularExchange: exchange._id,
        circularLegIndex: 2,
      }),
    ]);
    createdSwapIds.push(child0._id, child1._id, child2._id);

    exchange.legs[0].swapRequest = child0._id;
    exchange.legs[1].swapRequest = child1._id;
    exchange.legs[2].swapRequest = child2._id;
    await exchange.save();

    // ── 1. Teacher marks scheduled leg 0 completed ──
    console.log('--- 1. Teacher marks scheduled leg 0 completed ---');
    const teacherCompleteRes = await request(serverUrl, {
      method: 'PUT',
      path: `/api/circular/${exchange._id}/legs/0/complete`,
      token: tokenA,
      body: { notes: 'Finished React teaching session successfully' },
    });
    assert.strictEqual(teacherCompleteRes.status, 200);
    assert.strictEqual(teacherCompleteRes.data.status, 'teacher_completed');
    console.log('  ✅ Verified: Teacher A marked Leg 0 as teacher_completed');

    // ── 2. Learner cannot confirm before teacher completion ──
    console.log('\n--- 2. Learner cannot confirm before teacher completion ---');
    // On Leg 1, User C is learner, User B is teacher. Teacher B has NOT marked complete yet.
    const earlyConfirmRes = await request(serverUrl, {
      method: 'PUT',
      path: `/api/circular/${exchange._id}/legs/1/complete/confirm`,
      token: tokenC,
      body: { notes: 'Premature confirmation' },
    });
    assert.strictEqual(earlyConfirmRes.status, 400);
    assert(earlyConfirmRes.data.message.includes('Teacher has not marked this leg completed yet'));
    console.log('  ✅ Verified: Learner rejected with 400 if teacher has not marked complete yet');

    // ── 3. Learner can confirm after teacher completion ──
    console.log('\n--- 3. Learner can confirm after teacher completion ---');
    // On Leg 0, User B is learner. Teacher A marked complete in step 1.
    const learnerConfirmRes = await request(serverUrl, {
      method: 'PUT',
      path: `/api/circular/${exchange._id}/legs/0/complete/confirm`,
      token: tokenB,
      body: { notes: 'Confirmed! Great React lesson.' },
    });
    assert.strictEqual(learnerConfirmRes.status, 200);
    assert.strictEqual(learnerConfirmRes.data.status, 'completed');

    // Child SwapRequest status synchronized to 'completed'
    const updatedChild0 = await SwapRequest.findById(child0._id);
    assert.strictEqual(updatedChild0.status, 'completed');
    console.log('  ✅ Verified: Learner B confirmed Leg 0; leg & child SwapRequest status is completed');

    // ── 4. Observer cannot perform completion actions ──
    console.log('\n--- 4. Observer cannot perform completion actions ---');
    // On Leg 0, User C is observer (neither teacher nor learner)
    const observerCompleteRes = await request(serverUrl, {
      method: 'PUT',
      path: `/api/circular/${exchange._id}/legs/0/complete`,
      token: tokenC,
    });
    assert.strictEqual(observerCompleteRes.status, 403);

    const observerConfirmRes = await request(serverUrl, {
      method: 'PUT',
      path: `/api/circular/${exchange._id}/legs/0/complete/confirm`,
      token: tokenC,
    });
    assert.strictEqual(observerConfirmRes.status, 403);
    console.log('  ✅ Verified: Observer receives 403 Forbidden on both complete and confirm');

    // ── 5. Unscheduled legs cannot be completed ──
    console.log('\n--- 5. Unscheduled legs cannot be completed ---');
    // Leg 2 is unscheduled (status: 'active', scheduledAt: null)
    const unscheduledCompleteRes = await request(serverUrl, {
      method: 'PUT',
      path: `/api/circular/${exchange._id}/legs/2/complete`,
      token: tokenC, // User C is teacher of leg 2
    });
    assert.strictEqual(unscheduledCompleteRes.status, 400);
    assert(unscheduledCompleteRes.data.message.includes('leg must be scheduled first'));
    console.log('  ✅ Verified: Unscheduled leg cannot be marked completed (400 Bad Request)');

    // ── 6. Each of the three legs completes independently ──
    console.log('\n--- 6. Each of the three legs completes independently ---');
    const scheduleRes = await request(serverUrl, {
      method: 'GET',
      path: `/api/circular/${exchange._id}/schedule`,
      token: tokenA,
    });
    assert.strictEqual(scheduleRes.data.legs[0].status, 'completed');
    assert.strictEqual(scheduleRes.data.legs[1].status, 'scheduled');
    assert.strictEqual(scheduleRes.data.legs[2].status, 'active');
    console.log('  ✅ Verified: Leg 0 is completed, while Leg 1 is scheduled and Leg 2 is active');

    // ── 7. Completing one leg does not complete the parent prematurely ──
    console.log('\n--- 7. Completing one leg does not complete parent prematurely ---');
    const currentExchange = await CircularExchange.findById(exchange._id);
    assert.strictEqual(currentExchange.status, 'active');
    assert(!currentExchange.completedAt, 'Expected completedAt to be null/falsy while exchange is active');
    console.log('  ✅ Verified: Parent exchange status is still active');

    // ── 8. Third learner confirmation finalizes the parent exchange ──
    console.log('\n--- 8. Third learner confirmation automatically finalizes parent exchange ---');
    // Now schedule Leg 2 so it can be completed
    await CircularExchange.updateOne(
      { _id: exchange._id },
      {
        $set: {
          'legs.2.status': 'scheduled',
          'legs.2.scheduledAt': scheduledTime,
        },
      }
    );

    // Complete Leg 1: Teacher B completes, Learner C confirms
    await request(serverUrl, { method: 'PUT', path: `/api/circular/${exchange._id}/legs/1/complete`, token: tokenB });
    const leg1Confirm = await request(serverUrl, { method: 'PUT', path: `/api/circular/${exchange._id}/legs/1/complete/confirm`, token: tokenC });
    assert.strictEqual(leg1Confirm.status, 200);
    assert.strictEqual(leg1Confirm.data.exchangeFinalized, false); // Still 2 of 3

    // Complete Leg 2: Teacher C completes, Learner A confirms (3rd confirmation)
    await request(serverUrl, { method: 'PUT', path: `/api/circular/${exchange._id}/legs/2/complete`, token: tokenC });
    const leg2Confirm = await request(serverUrl, { method: 'PUT', path: `/api/circular/${exchange._id}/legs/2/complete/confirm`, token: tokenA });
    assert.strictEqual(leg2Confirm.status, 200);
    assert.strictEqual(leg2Confirm.data.exchangeFinalized, true);
    assert.strictEqual(leg2Confirm.data.exchangeStatus, 'completed');

    // Check database record
    const finalizedDoc = await CircularExchange.findById(exchange._id);
    assert.strictEqual(finalizedDoc.status, 'completed');
    assert(finalizedDoc.completedAt);
    console.log('  ✅ Verified: All 3 legs completed -> Parent exchange finalized with completedAt:', finalizedDoc.completedAt);

    // ── 9. Duplicate requests are handled safely (idempotent) ──
    console.log('\n--- 9. Duplicate requests handled safely (idempotent) ---');
    const duplicateConfirm = await request(serverUrl, {
      method: 'PUT',
      path: `/api/circular/${exchange._id}/legs/0/complete/confirm`,
      token: tokenB,
    });
    assert.strictEqual(duplicateConfirm.status, 200);
    assert(duplicateConfirm.data.message.includes('already'));
    console.log('  ✅ Verified: Repeated confirmation returns HTTP 200 idempotently');

    // ── 10. Bilateral completion remains unchanged ──
    console.log('\n--- 10. Bilateral swap completion remains unchanged ---');
    const bilateralSwap = await SwapRequest.create({
      fromUser: userA._id,
      toUser: userB._id,
      offeredSkill: 'Python',
      wantedSkill: 'Design',
      status: 'accepted',
      roomId: `skillswap-bilateral-comp-${Date.now()}`,
    });
    createdSwapIds.push(bilateralSwap._id);

    const bilateralCompleteRes = await request(serverUrl, {
      method: 'PUT',
      path: `/api/swap/${bilateralSwap._id}/complete`,
      token: tokenA,
    });
    assert.strictEqual(bilateralCompleteRes.status, 200);
    const updatedBilateral = await SwapRequest.findById(bilateralSwap._id);
    assert.strictEqual(updatedBilateral.status, 'completed');
    console.log('  ✅ Verified: Bilateral completion functions independently without regression');

    console.log('\n===============================================================');
    console.log('🎉 ALL 10 STAGE 4 COMPLETION CHECKS PASSED!');
    console.log('===============================================================\n');
  } finally {
    assertTestDatabaseSafe();
    await OutboxEvent.deleteMany({
      $or: [
        { aggregateId: { $in: createdExchangeIds } },
        { recipient: { $in: createdUserIds } },
        { sender: { $in: createdUserIds } },
        { relatedSwap: { $in: createdSwapIds } },
      ],
    });
    await Notification.deleteMany({
      $or: [
        { recipient: { $in: createdUserIds } },
        { sender: { $in: createdUserIds } },
        { relatedSwap: { $in: createdSwapIds } },
      ],
    });
    await SwapRequest.deleteMany({ _id: { $in: createdSwapIds } });
    await CircularExchange.deleteMany({ _id: { $in: createdExchangeIds } });
    await User.deleteMany({ _id: { $in: createdUserIds } });
    await new Promise(resolve => testServer.close(resolve));
    await disconnectTestDb();
  }
}

runStage4Verification().catch(err => {
  console.error('❌ Stage 4 completion verification failed:', err);
  process.exit(1);
});
