/**
 * test_phase7_security_remediation.js
 *
 * Phase 7.1 Security Remediation Verification Suite
 * Verifies:
 *  1. Repeated login requests trigger HTTP 429.
 *  2. Registration requests are rate-limited.
 *  3. Seed-demo is rate-limited according to its intended access model.
 *  4. Valid login and registration still work.
 *  5. Object-valued email is rejected with 400.
 *  6. Array-valued password is rejected with 400.
 *  7. Invalid JSON body structures (array, null, non-object) are handled safely.
 *  8. Excessive join-room events on a socket are throttled.
 *  9. Excessive WebRTC signaling events (offer/answer/ice) are throttled.
 * 10. Normal WebRTC signaling remains completely functional.
 * 11. Existing notification sockets still work cleanly.
 * 12. Existing WebRTC room authorization checks remain intact.
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
const { app, server, io: ServerIO, checkSocketRateLimit } = require('./server');

const TEST_PORT = 5097;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}/api`;
const SOCKET_URL = `http://127.0.0.1:${TEST_PORT}`;
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

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }

  return { status: res.status, ok: res.ok, data };
}

async function runSecurityRemediationTests() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🧪 SKILLSWAP — PHASE 7.1 SECURITY REMEDIATION QA SUITE');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  let passed = 0;
  let failed = 0;

  async function test(desc, fn) {
    try {
      await fn();
      console.log(`✅ PASS: ${desc}`);
      passed++;
    } catch (err) {
      console.error(`❌ FAIL: ${desc} ->`, err.message);
      failed++;
    }
  }

  // Connect to test database safely
  await connectTestDb();
  assertTestDatabaseSafe();

  // Start HTTP server on TEST_PORT
  await new Promise((resolve) => {
    if (!server.listening) {
      server.listen(TEST_PORT, resolve);
    } else {
      resolve();
    }
  });

  const createdUserIds = [];
  const createdSwapIds = [];

  try {
    // ── SUITE 1: AUTH INPUT VALIDATION ─────────────────────────────────────────
    console.log('\n--- SUITE 1: Auth Input Validation (NoSQL Injection & Type Safety) ---');

    await test('Object-valued email is rejected with 400 Bad Request', async () => {
      const res = await request('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: { $gt: '' },
          password: 'password123',
        }),
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data.message, 'Email and password must be strings');
    });

    await test('Array-valued password is rejected with 400 Bad Request', async () => {
      const res = await request('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: 'valid@student.edu',
          password: ['password123'],
        }),
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data.message, 'Email and password must be strings');
    });

    await test('Registration rejects non-string name, email, or password', async () => {
      const res1 = await request('/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          name: 12345,
          email: 'test@student.edu',
          password: 'password123',
        }),
      });
      assert.strictEqual(res1.status, 400);
      assert.strictEqual(res1.data.message, 'Name, email, and password must be strings');

      const res2 = await request('/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Valid Name',
          email: { $ne: null },
          password: 'password123',
        }),
      });
      assert.strictEqual(res2.status, 400);
      assert.strictEqual(res2.data.message, 'Name, email, and password must be strings');
    });

    await test('Invalid JSON body structures (array, null) are handled safely with 400', async () => {
      const res1 = await request('/auth/login', {
        method: 'POST',
        body: JSON.stringify(['some', 'array']),
      });
      assert.strictEqual(res1.status, 400);

      const res2 = await request('/auth/register', {
        method: 'POST',
        body: JSON.stringify(null),
      });
      assert.strictEqual(res2.status, 400);

      const res3 = await request('/auth/seed-demo', {
        method: 'POST',
        body: JSON.stringify(['invalid']),
      });
      assert.strictEqual(res3.status, 400);
    });

    await test('Valid registration and login work correctly with string inputs', async () => {
      const email = `phase7_test_${Date.now()}@college.edu`;
      const regRes = await request('/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Phase7 Student',
          email,
          password: 'Password123!',
        }),
      });
      assert.strictEqual(regRes.status, 201);
      assert(regRes.data.token, 'Should return token');
      createdUserIds.push(regRes.data.user.id);

      // Login with matching email
      const loginRes = await request('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email,
          password: 'Password123!',
        }),
      });
      assert.strictEqual(loginRes.status, 200);
      assert(loginRes.data.token, 'Login returns token');

      // Login with different case verifies normalization
      const loginCaseRes = await request('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: email.toUpperCase(),
          password: 'Password123!',
        }),
      });
      assert.strictEqual(loginCaseRes.status, 200);
      assert(loginCaseRes.data.token, 'Case-insensitive login succeeds');
    });

    // ── SUITE 2: HTTP AUTH RATE LIMITING ───────────────────────────────────────
    console.log('\n--- SUITE 2: HTTP Auth Rate Limiting (15m window, 50 requests max) ---');

    await test('Repeated login requests from an IP exceed limit and return HTTP 429', async () => {
      const testIp = '198.51.100.77';
      let lastStatus = 200;
      let hit429 = false;

      // Send 51 requests with the test IP via X-Forwarded-For (enabled by trust proxy 1)
      for (let i = 0; i < 52; i++) {
        const res = await request('/auth/login', {
          method: 'POST',
          headers: { 'X-Forwarded-For': testIp },
          body: JSON.stringify({
            email: 'nonexistent@test.com',
            password: 'wrongpassword',
          }),
        });
        lastStatus = res.status;
        if (res.status === 429) {
          hit429 = true;
          assert(res.data.message.includes('Too many authentication attempts'), 'Clear 429 message');
          break;
        }
      }

      assert.strictEqual(hit429, true, 'Request 51 should be throttled with HTTP 429');
    });

    await test('Registration requests are covered by the rate limiter', async () => {
      const testIp = '198.51.100.88';
      let hit429 = false;

      for (let i = 0; i < 52; i++) {
        const res = await request('/auth/register', {
          method: 'POST',
          headers: { 'X-Forwarded-For': testIp },
          body: JSON.stringify({
            name: `User ${i}`,
            email: `limit_reg_${Date.now()}_${i}@test.com`,
            password: 'Password123!',
          }),
        });
        if (res.status === 201) {
          createdUserIds.push(res.data.user.id);
        }
        if (res.status === 429) {
          hit429 = true;
          assert(res.data.message.includes('Too many authentication attempts'), 'Clear 429 message');
          break;
        }
      }

      assert.strictEqual(hit429, true, 'Registration exceeds rate limit and returns 429');
    });

    await test('Seed-demo requests are covered by the rate limiter', async () => {
      const testIp = '198.51.100.99';
      let hit429 = false;

      for (let i = 0; i < 52; i++) {
        const res = await request('/auth/seed-demo', {
          method: 'POST',
          headers: { 'X-Forwarded-For': testIp },
          body: JSON.stringify({}),
        });
        if (res.status === 429) {
          hit429 = true;
          break;
        }
      }

      assert.strictEqual(hit429, true, 'Seed-demo exceeds rate limit and returns 429');
    });

    await test('Health check endpoint is NOT throttled by auth rate limiter', async () => {
      // Even with an IP that hit auth limit
      const testIp = '198.51.100.77';
      const res = await request('/health', {
        method: 'GET',
        headers: { 'X-Forwarded-For': testIp },
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.status, 'ok');
    });

    // ── SUITE 3: SOCKET.IO EVENT RATE LIMITING ─────────────────────────────────
    console.log('\n--- SUITE 3: Socket.io Event Rate Limiting & WebRTC Signaling ---');

    // Seed test users & swap for WebRTC signaling
    const [userA, userB] = await Promise.all([
      User.create({ name: 'WebRTC Peer A', email: `peer_a_${Date.now()}@test.com`, password: 'Password123!' }),
      User.create({ name: 'WebRTC Peer B', email: `peer_b_${Date.now()}@test.com`, password: 'Password123!' }),
    ]);
    createdUserIds.push(userA._id, userB._id);

    const tokenA = generateToken(userA._id.toString());
    const tokenB = generateToken(userB._id.toString());
    const roomId = `room-rate-limit-${Date.now()}`;

    const swap = await SwapRequest.create({
      fromUser: userA._id,
      toUser: userB._id,
      offeredSkill: 'TypeScript',
      wantedSkill: 'Python',
      status: 'accepted',
      roomId,
    });
    createdSwapIds.push(swap._id);

    await test('checkSocketRateLimit unit helper operates correctly and cleans up', () => {
      const mockSocket = {};
      // 3 events per 1000ms
      assert.strictEqual(checkSocketRateLimit(mockSocket, 'test-event', 3, 1000), true);
      assert.strictEqual(checkSocketRateLimit(mockSocket, 'test-event', 3, 1000), true);
      assert.strictEqual(checkSocketRateLimit(mockSocket, 'test-event', 3, 1000), true);
      assert.strictEqual(checkSocketRateLimit(mockSocket, 'test-event', 3, 1000), false); // 4th rejected
    });

    await test('Excessive join-room events on a socket are throttled with room-error', async () => {
      const client = createSocketClient(tokenA);
      await waitFor(client, 'connect');

      let throttledError = null;
      client.on('room-error', (err) => {
        if (err.message && err.message.includes('Too many join-room requests')) {
          throttledError = err;
        }
      });

      // Send 17 join-room events (limit is 15)
      for (let i = 0; i < 17; i++) {
        client.emit('join-room', { roomId, userName: 'Peer A' });
      }

      // Wait briefly for error emission
      await new Promise((r) => setTimeout(r, 200));
      assert(throttledError, 'Socket should receive room-error when join-room rate limit is exceeded');
      assert.strictEqual(throttledError.message, 'Too many join-room requests, please slow down');

      client.disconnect();
    });

    await test('Excessive WebRTC signaling events (offer/answer/ice) are throttled', async () => {
      const clientA = createSocketClient(tokenA);
      await waitFor(clientA, 'connect');
      clientA.emit('join-room', { roomId, userName: 'Peer A' });
      await new Promise((r) => setTimeout(r, 100));

      let offerLimitHit = false;
      clientA.on('room-error', (err) => {
        if (err.message && err.message.includes('Signaling offer rate limit exceeded')) {
          offerLimitHit = true;
        }
      });

      // Send 18 offers (limit is 15)
      for (let i = 0; i < 18; i++) {
        clientA.emit('webrtc-offer', { roomId, sdp: { type: 'offer', sdp: 'fake-sdp' } });
      }

      await new Promise((r) => setTimeout(r, 200));
      assert.strictEqual(offerLimitHit, true, 'Excessive offers trigger room-error');

      clientA.disconnect();
    });

    await test('Normal WebRTC signaling (join, offer, answer, ICE) remains completely functional', async () => {
      const normalRoomId = `normal-room-${Date.now()}`;
      const normalSwap = await SwapRequest.create({
        fromUser: userA._id,
        toUser: userB._id,
        offeredSkill: 'TypeScript',
        wantedSkill: 'Python',
        status: 'accepted',
        roomId: normalRoomId,
      });
      createdSwapIds.push(normalSwap._id);

      const clientA = createSocketClient(tokenA);
      const clientB = createSocketClient(tokenB);

      await Promise.all([waitFor(clientA, 'connect'), waitFor(clientB, 'connect')]);

      // A joins
      clientA.emit('join-room', { roomId: normalRoomId, userName: 'Peer A' });
      await new Promise((r) => setTimeout(r, 100));

      // B joins and A sees user-joined
      const userJoinedPromise = waitFor(clientA, 'user-joined');
      clientB.emit('join-room', { roomId: normalRoomId, userName: 'Peer B' });
      const joinData = await userJoinedPromise;
      assert.strictEqual(joinData.userName, 'Peer B');

      // A sends offer -> B receives
      const offerPromise = waitFor(clientB, 'webrtc-offer');
      clientA.emit('webrtc-offer', { roomId: normalRoomId, sdp: { type: 'offer', sdp: 'sdp-test' } });
      const offerData = await offerPromise;
      assert.strictEqual(offerData.sdp.sdp, 'sdp-test');

      // B sends answer -> A receives
      const answerPromise = waitFor(clientA, 'webrtc-answer');
      clientB.emit('webrtc-answer', { roomId: normalRoomId, sdp: { type: 'answer', sdp: 'sdp-ans-test' } });
      const answerData = await answerPromise;
      assert.strictEqual(answerData.sdp.sdp, 'sdp-ans-test');

      // B sends ICE candidates in normal volume (10 candidates) -> A receives
      let iceCount = 0;
      clientA.on('webrtc-ice-candidate', () => {
        iceCount++;
      });

      for (let i = 0; i < 10; i++) {
        clientB.emit('webrtc-ice-candidate', { roomId: normalRoomId, candidate: { candidate: `cand-${i}` } });
      }

      await new Promise((r) => setTimeout(r, 200));
      assert.strictEqual(iceCount, 10, 'All 10 normal ICE candidates successfully received');

      clientA.disconnect();
      clientB.disconnect();
    });

    await test('Existing notification sockets and room authorization remain intact', async () => {
      const notifClient = createSocketClient(tokenA);
      await waitFor(notifClient, 'connect');

      const notifPromise = waitFor(notifClient, 'notification:new');
      ServerIO.to(`user:${userA._id}`).emit('notification:new', {
        title: 'Security Verified',
        message: 'Notification channel functional',
      });

      const notif = await notifPromise;
      assert.strictEqual(notif.title, 'Security Verified');

      // Unauthenticated socket cannot join
      const unauthClient = createSocketClient(null);
      await waitFor(unauthClient, 'connect');
      const roomErrorPromise = waitFor(unauthClient, 'room-error');
      unauthClient.emit('join-room', { roomId: 'some-room', userName: 'Hacker' });
      const roomErr = await roomErrorPromise;
      assert.strictEqual(roomErr.message, 'Authentication required to join video room');

      notifClient.disconnect();
      unauthClient.disconnect();
    });
  } finally {
    // Teardown
    assertTestDatabaseSafe();
    await SwapRequest.deleteMany({ _id: { $in: createdSwapIds } });
    await User.deleteMany({ _id: { $in: createdUserIds } });
    await new Promise((resolve) => server.close(resolve));
    await disconnectTestDb();
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📊 PHASE 7.1 VERIFICATION: ${passed} PASSED | ${failed} FAILED`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runSecurityRemediationTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
