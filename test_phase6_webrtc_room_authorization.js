/**
 * test_phase6_webrtc_room_authorization.js
 * Comprehensive automated security verification suite for Socket.io WebRTC room authorization.
 *
 * Verifies all 16 security requirements:
 * 1.  Valid bilateral teacher/user joins.
 * 2.  Valid bilateral learner/user joins.
 * 3.  Valid circular teacher joins.
 * 4.  Valid circular learner joins.
 * 5.  Third circular participant is rejected (Forbidden).
 * 6.  Unrelated authenticated user is rejected (Forbidden).
 * 7.  Unauthenticated socket is rejected (Auth required).
 * 8.  Invalid JWT is rejected (Auth required).
 * 9.  Unknown roomId is rejected (Not found).
 * 10. Cancelled/ineligible swap cannot be joined (Inactive).
 * 11. Non-room member cannot send offers.
 * 12. Non-room member cannot send answers.
 * 13. Non-room member cannot send ICE candidates.
 * 14. Authorized bilateral WebRTC signaling remains functional.
 * 15. Authorized circular WebRTC signaling remains functional.
 * 16. Notification Socket.io functionality remains intact.
 */

'use strict';

const { connectTestDb, disconnectTestDb, assertTestDatabaseSafe } = require('./test_db_guard');
require('dotenv').config();
const assert = require('assert');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { io: ClientIO } = require('./frontend/node_modules/socket.io-client');
const User = require('./models/User');
const SwapRequest = require('./models/SwapRequest');
const CircularExchange = require('./models/CircularExchange');
const { server, io: ServerIO } = require('./server');

const TEST_PORT = 5098;
const SOCKET_URL = `http://localhost:${TEST_PORT}`;
const JWT_SECRET = process.env.JWT_SECRET || 'skillswap-dev-secret-key-2026';

function generateToken(id) {
  return jwt.sign({ id }, JWT_SECRET, { expiresIn: '1h' });
}

function createSocketClient(token = null) {
  const opts = {
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
  };
  if (token) {
    opts.auth = { token };
  }
  return ClientIO(SOCKET_URL, opts);
}

function waitFor(client, event, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for event "${event}" after ${timeoutMs}ms`));
    }, timeoutMs);

    client.once(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

async function runSecuritySuite() {
  console.log('\n===============================================================');
  console.log('🔒 Starting WebRTC Room Authorization Security Test Suite');
  console.log('===============================================================\n');

  await connectTestDb();
  assertTestDatabaseSafe();

  // Start HTTP server on test port if not already listening
  await new Promise((resolve) => {
    if (!server.listening) {
      server.listen(TEST_PORT, resolve);
    } else {
      resolve();
    }
  });

  const createdUserIds = [];
  const createdSwapIds = [];
  const createdExchangeIds = [];

  try {
    // 1. Create test users
    const [userA, userB, userC, userD] = await Promise.all([
      User.create({ name: 'User_A_Teacher', email: `user_a_${Date.now()}@test.com`, password: 'Password123!' }),
      User.create({ name: 'User_B_Learner', email: `user_b_${Date.now()}@test.com`, password: 'Password123!' }),
      User.create({ name: 'User_C_Observer', email: `user_c_${Date.now()}@test.com`, password: 'Password123!' }),
      User.create({ name: 'User_D_Unrelated', email: `user_d_${Date.now()}@test.com`, password: 'Password123!' }),
    ]);
    createdUserIds.push(userA._id, userB._id, userC._id, userD._id);

    const tokenA = generateToken(userA._id.toString());
    const tokenB = generateToken(userB._id.toString());
    const tokenC = generateToken(userC._id.toString());
    const tokenD = generateToken(userD._id.toString());

    // 2. Create bilateral accepted swap
    const bilateralSwap = await SwapRequest.create({
      fromUser: userA._id,
      toUser: userB._id,
      offeredSkill: 'React',
      wantedSkill: 'Python',
      status: 'accepted',
      roomId: `skillswap-${new mongoose.Types.ObjectId()}`,
    });
    createdSwapIds.push(bilateralSwap._id);

    // 3. Create circular exchange with child swaps
    const circularExchange = await CircularExchange.create({
      initiator: userA._id,
      participants: [
        { user: userA._id, hasAccepted: true },
        { user: userB._id, hasAccepted: true },
        { user: userC._id, hasAccepted: true },
      ],
      legs: [
        { legIndex: 0, teacher: userA._id, learner: userB._id, skill: 'React', status: 'active', roomId: `skillswap-circular-leg-0-${Date.now()}` },
        { legIndex: 1, teacher: userB._id, learner: userC._id, skill: 'Node.js', status: 'active', roomId: `skillswap-circular-leg-1-${Date.now()}` },
        { legIndex: 2, teacher: userC._id, learner: userA._id, skill: 'UI/UX', status: 'active', roomId: `skillswap-circular-leg-2-${Date.now()}` },
      ],
      cycleScore: 90,
      expiresAt: new Date(Date.now() + 100000),
      status: 'active',
      canonicalCycleHash: `hash-${Date.now()}`,
    });
    createdExchangeIds.push(circularExchange._id);

    // Create child swaps for leg 0 and leg 1
    const circularChildSwapLeg0 = await SwapRequest.create({
      fromUser: userA._id, // Teacher for leg 0
      toUser: userB._id,   // Learner for leg 0
      offeredSkill: 'React',
      wantedSkill: '[Circular Exchange]',
      status: 'accepted',
      roomId: circularExchange.legs[0].roomId,
      circularExchange: circularExchange._id,
      circularLegIndex: 0,
    });
    createdSwapIds.push(circularChildSwapLeg0._id);

    // 4. Create cancelled swap
    const cancelledSwap = await SwapRequest.create({
      fromUser: userA._id,
      toUser: userB._id,
      offeredSkill: 'Ruby',
      wantedSkill: 'Rust',
      status: 'cancelled',
      roomId: `skillswap-cancelled-${Date.now()}`,
    });
    createdSwapIds.push(cancelledSwap._id);

    console.log('--- Suite 1: Bilateral WebRTC Room Authorization ---');

    // Test 1: Valid bilateral teacher joins
    const clientA = createSocketClient(tokenA);
    await waitFor(clientA, 'connect');
    clientA.emit('join-room', { roomId: bilateralSwap.roomId, userName: userA.name });

    // Test 2: Valid bilateral learner joins
    const clientB = createSocketClient(tokenB);
    await waitFor(clientB, 'connect');
    const userJoinedPromise = waitFor(clientA, 'user-joined');
    clientB.emit('join-room', { roomId: bilateralSwap.roomId, userName: userB.name });
    const joinedPayload = await userJoinedPromise;
    assert.strictEqual(joinedPayload.userName, userB.name);
    console.log('  ✅ 1. Valid bilateral teacher/user joins');
    console.log('  ✅ 2. Valid bilateral learner/user joins & receives user-joined');

    console.log('\n--- Suite 2: Circular WebRTC Room Authorization ---');

    // Test 3: Valid circular teacher joins leg 0
    const clientCircTeacher = createSocketClient(tokenA);
    await waitFor(clientCircTeacher, 'connect');
    clientCircTeacher.emit('join-room', { roomId: circularChildSwapLeg0.roomId, userName: userA.name });

    // Test 4: Valid circular learner joins leg 0
    const clientCircLearner = createSocketClient(tokenB);
    await waitFor(clientCircLearner, 'connect');
    const circJoinedPromise = waitFor(clientCircTeacher, 'user-joined');
    clientCircLearner.emit('join-room', { roomId: circularChildSwapLeg0.roomId, userName: userB.name });
    const circJoined = await circJoinedPromise;
    assert.strictEqual(circJoined.userName, userB.name);
    console.log('  ✅ 3. Valid circular teacher joins child leg 0 room');
    console.log('  ✅ 4. Valid circular learner joins child leg 0 room');

    console.log('\n--- Suite 3: Unauthorized Access & Boundary Protection ---');

    // Test 5: Third circular participant (User C) is rejected from leg 0 (they only participate in leg 1 and 2)
    const clientCircObserver = createSocketClient(tokenC);
    await waitFor(clientCircObserver, 'connect');
    const observerErrorPromise = waitFor(clientCircObserver, 'room-error');
    clientCircObserver.emit('join-room', { roomId: circularChildSwapLeg0.roomId, userName: userC.name });
    const observerError = await observerErrorPromise;
    assert(observerError.message.includes('Forbidden'), 'Expected Forbidden error for 3rd circular participant');
    console.log('  ✅ 5. Third circular participant (observer) is rejected with Forbidden error');

    // Test 6: Unrelated authenticated user (User D) is rejected
    const clientD = createSocketClient(tokenD);
    await waitFor(clientD, 'connect');
    const unrelatedErrorPromise = waitFor(clientD, 'room-error');
    clientD.emit('join-room', { roomId: bilateralSwap.roomId, userName: userD.name });
    const unrelatedError = await unrelatedErrorPromise;
    assert(unrelatedError.message.includes('Forbidden'), 'Expected Forbidden error for unrelated user');
    console.log('  ✅ 6. Unrelated authenticated user is rejected with Forbidden error');

    // Test 7: Unauthenticated socket is rejected
    const clientUnauth = createSocketClient(null);
    await waitFor(clientUnauth, 'connect');
    const unauthErrorPromise = waitFor(clientUnauth, 'room-error');
    clientUnauth.emit('join-room', { roomId: bilateralSwap.roomId, userName: 'Anonymous' });
    const unauthError = await unauthErrorPromise;
    assert(unauthError.message.includes('Authentication required'), 'Expected Authentication required error');
    console.log('  ✅ 7. Unauthenticated socket is rejected with Auth Required error');

    // Test 8: Invalid JWT is rejected
    const clientInvalidJwt = createSocketClient('invalid.fake.jwt.token');
    await waitFor(clientInvalidJwt, 'connect');
    const invalidJwtErrorPromise = waitFor(clientInvalidJwt, 'room-error');
    clientInvalidJwt.emit('join-room', { roomId: bilateralSwap.roomId, userName: 'Hacker' });
    const invalidJwtError = await invalidJwtErrorPromise;
    assert(invalidJwtError.message.includes('Authentication required'), 'Expected Auth Required error for bad token');
    console.log('  ✅ 8. Invalid JWT is rejected with Auth Required error');

    // Test 9: Unknown roomId is rejected
    const unknownErrorPromise = waitFor(clientA, 'room-error');
    clientA.emit('join-room', { roomId: 'unknown-nonexistent-room-999', userName: userA.name });
    const unknownError = await unknownErrorPromise;
    assert(unknownError.message.includes('not found'), 'Expected Video room not found error');
    console.log('  ✅ 9. Unknown roomId is rejected with Not Found error');

    // Test 10: Cancelled or ineligible swap cannot be joined
    const cancelledErrorPromise = waitFor(clientA, 'room-error');
    clientA.emit('join-room', { roomId: cancelledSwap.roomId, userName: userA.name });
    const cancelledError = await cancelledErrorPromise;
    assert(cancelledError.message.includes('cancelled'), 'Expected error indicating swap is cancelled');
    console.log('  ✅ 10. Cancelled or ineligible swap cannot be joined');

    console.log('\n--- Suite 4: WebRTC Signaling Protection ---');

    // Test 11: Non-room member cannot send offers
    const offerErrorPromise = waitFor(clientD, 'room-error');
    clientD.emit('webrtc-offer', { roomId: bilateralSwap.roomId, sdp: { type: 'offer', sdp: 'fake-sdp' } });
    const offerError = await offerErrorPromise;
    assert(offerError.message.includes('unjoined room'));
    console.log('  ✅ 11. Non-room member cannot send WebRTC offers');

    // Test 12: Non-room member cannot send answers
    const answerErrorPromise = waitFor(clientD, 'room-error');
    clientD.emit('webrtc-answer', { roomId: bilateralSwap.roomId, sdp: { type: 'answer', sdp: 'fake-sdp' } });
    const answerError = await answerErrorPromise;
    assert(answerError.message.includes('unjoined room'));
    console.log('  ✅ 12. Non-room member cannot send WebRTC answers');

    // Test 13: Non-room member cannot send ICE candidates
    const iceErrorPromise = waitFor(clientD, 'room-error');
    clientD.emit('webrtc-ice-candidate', { roomId: bilateralSwap.roomId, candidate: { candidate: 'candidate:1 1 UDP ...' } });
    const iceError = await iceErrorPromise;
    assert(iceError.message.includes('unjoined room'));
    console.log('  ✅ 13. Non-room member cannot send ICE candidates');

    console.log('\n--- Suite 5: Functional Signaling Between Authorized Peers ---');

    // Test 14: Authorized bilateral WebRTC signaling works
    const bilateralOfferPromise = waitFor(clientB, 'webrtc-offer');
    clientA.emit('webrtc-offer', { roomId: bilateralSwap.roomId, sdp: { type: 'offer', sdp: 'v=0\r\no=alice...' } });
    const receivedOffer = await bilateralOfferPromise;
    assert.strictEqual(receivedOffer.sdp.type, 'offer');
    assert.strictEqual(receivedOffer.senderId, clientA.id);

    const bilateralAnswerPromise = waitFor(clientA, 'webrtc-answer');
    clientB.emit('webrtc-answer', { roomId: bilateralSwap.roomId, sdp: { type: 'answer', sdp: 'v=0\r\no=bob...' } });
    const receivedAnswer = await bilateralAnswerPromise;
    assert.strictEqual(receivedAnswer.sdp.type, 'answer');
    assert.strictEqual(receivedAnswer.senderId, clientB.id);

    const bilateralIcePromise = waitFor(clientB, 'webrtc-ice-candidate');
    clientA.emit('webrtc-ice-candidate', { roomId: bilateralSwap.roomId, candidate: { candidate: 'candidate:valid-ice-candidate' } });
    const receivedIce = await bilateralIcePromise;
    assert.strictEqual(receivedIce.candidate.candidate, 'candidate:valid-ice-candidate');
    console.log('  ✅ 14. Authorized bilateral WebRTC signaling (offer/answer/ICE) functions cleanly');

    // Test 15: Authorized circular WebRTC signaling works
    const circOfferPromise = waitFor(clientCircLearner, 'webrtc-offer');
    clientCircTeacher.emit('webrtc-offer', { roomId: circularChildSwapLeg0.roomId, sdp: { type: 'offer', sdp: 'v=0\r\no=circ-teacher...' } });
    const receivedCircOffer = await circOfferPromise;
    assert.strictEqual(receivedCircOffer.sdp.type, 'offer');

    const circAnswerPromise = waitFor(clientCircTeacher, 'webrtc-answer');
    clientCircLearner.emit('webrtc-answer', { roomId: circularChildSwapLeg0.roomId, sdp: { type: 'answer', sdp: 'v=0\r\no=circ-learner...' } });
    const receivedCircAnswer = await circAnswerPromise;
    assert.strictEqual(receivedCircAnswer.sdp.type, 'answer');
    console.log('  ✅ 15. Authorized circular WebRTC signaling functions cleanly');

    // Test 16: Notification Socket.io functionality remains intact
    console.log('\n--- Suite 6: Notification Channel Compatibility ---');
    const notifClient = createSocketClient(tokenA);
    await waitFor(notifClient, 'connect');
    const notifPromise = waitFor(notifClient, 'notification:new');
    ServerIO.to(`user:${userA._id}`).emit('notification:new', {
      _id: new mongoose.Types.ObjectId(),
      title: 'Session Reminder 🔔',
      message: 'Your upcoming skill session starts soon.',
    });
    const receivedNotif = await notifPromise;
    assert.strictEqual(receivedNotif.title, 'Session Reminder 🔔');
    console.log('  ✅ 16. Notification Socket.io channel remains completely intact');

    // Disconnect clients
    [clientA, clientB, clientCircTeacher, clientCircLearner, clientCircObserver, clientD, clientUnauth, clientInvalidJwt, notifClient].forEach(c => {
      try { c.disconnect(); } catch (_) {}
    });

    console.log('\n===============================================================');
    console.log('🎉 ALL 16 WEBRTC SECURITY TESTS PASSED CLEANLY!');
    console.log('===============================================================\n');
  } finally {
    // Cleanup database records
    assertTestDatabaseSafe();
    await SwapRequest.deleteMany({ _id: { $in: createdSwapIds } });
    await CircularExchange.deleteMany({ _id: { $in: createdExchangeIds } });
    await User.deleteMany({ _id: { $in: createdUserIds } });
    await new Promise(resolve => server.close(resolve));
    await disconnectTestDb();
  }
}

runSecuritySuite().catch(err => {
  console.error('❌ Security suite error:', err);
  process.exit(1);
});
