const mongoose = require('mongoose');
const { io } = require('/Users/pavanmv/Downloads/frontend/node_modules/socket.io-client');
const { checkUpcomingSessionReminders } = require('./services/reminderService');
const { createAndEmitNotification } = require('./services/notificationService');

const BASE_URL = 'http://localhost:5001/api';
const SOCKET_URL = 'http://localhost:5001';
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/skillswap';

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

async function runTests() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🧪 SKILLSWAP PHASE 2 — NOTIFICATIONS & COMMUNICATION QA SUITE');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, testName) {
    if (condition) {
      console.log(`✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${testName}`);
      failed++;
    }
  }

  const socketsToClose = [];

  try {
    // Connect Mongoose so direct service calls (like reminder scheduler) execute cleanly
    await mongoose.connect(MONGO_URI);

    // ── Setup: Create 2 Test Users (Alice & Bob) ──────────────────────────
    const timestamp = Date.now();
    const aliceEmail = `alice_${timestamp}@test.edu`;
    const bobEmail   = `bob_${timestamp}@test.edu`;

    const regAlice = await request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: 'Alice Test', email: aliceEmail, password: 'password123' }),
    });
    const aliceToken = regAlice.data.token;
    const aliceId    = regAlice.data.user.id;
    const aliceAuth  = { headers: { Authorization: `Bearer ${aliceToken}` } };

    const regBob = await request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: 'Bob Test', email: bobEmail, password: 'password123' }),
    });
    const bobToken = regBob.data.token;
    const bobId    = regBob.data.user.id;
    const bobAuth  = { headers: { Authorization: `Bearer ${bobToken}` } };

    // Update their skills so they match
    await request('/profile', {
      method: 'PUT',
      ...aliceAuth,
      body: JSON.stringify({
        skillsOffered: [{ skill: 'Python', category: 'Programming', level: 'Advanced' }],
        skillsWanted:  [{ skill: 'React', category: 'Programming', priority: 'High' }],
        availabilitySlots: [{ day: 'Monday', from: '18:00', to: '20:00' }],
      }),
    });

    await request('/profile', {
      method: 'PUT',
      ...bobAuth,
      body: JSON.stringify({
        skillsOffered: [{ skill: 'React', category: 'Programming', level: 'Advanced' }],
        skillsWanted:  [{ skill: 'Python', category: 'Programming', priority: 'High' }],
        availabilitySlots: [{ day: 'Monday', from: '18:00', to: '20:00' }],
      }),
    });

    // ── Setup: Connect Authenticated Sockets ──────────────────────────────
    const bobSocket = io(SOCKET_URL, {
      auth: { token: bobToken },
      transports: ['websocket'],
    });
    socketsToClose.push(bobSocket);

    await new Promise((resolve) => {
      bobSocket.on('connect', resolve);
    });

    // ── 1. Real-time Notification Delivery (Socket.io) & Swap Request ─────
    let receivedRealtimeNotif = null;
    const notifPromise = new Promise((resolve) => {
      bobSocket.on('notification:new', (notif) => {
        receivedRealtimeNotif = notif;
        resolve(notif);
      });
    });

    // Alice proposes a swap to Bob
    const swapProposal = await request('/swap', {
      method: 'POST',
      ...aliceAuth,
      body: JSON.stringify({
        toUser: bobId,
        offeredSkill: 'Python',
        wantedSkill: 'React',
      }),
    });
    assert(swapProposal.status === 201, '1. Swap request created via API');
    const swapId = swapProposal.data._id;

    // Wait for Bob's socket to receive the real-time notification
    await Promise.race([
      notifPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout waiting for real-time notification')), 4000)),
    ]);

    assert(
      receivedRealtimeNotif &&
      receivedRealtimeNotif.type === 'SWAP_REQUEST' &&
      receivedRealtimeNotif.recipient.toString() === bobId.toString(),
      '9. Real-time notification delivery via Socket.io private room'
    );
    assert(receivedRealtimeNotif.type === 'SWAP_REQUEST', '11. Swap request notification triggered for recipient');

    // ── 2. Notification Persistence After Refresh ────────────────────────
    const bobNotifsAfterCreation = await request('/notifications', { method: 'GET', ...bobAuth });
    assert(
      bobNotifsAfterCreation.status === 200 &&
      bobNotifsAfterCreation.data.notifications.length >= 1 &&
      bobNotifsAfterCreation.data.notifications[0].type === 'SWAP_REQUEST',
      '2. Notification persistence verified in MongoDB'
    );

    // ── 3. Notification Retrieval & Pagination ────────────────────────────
    assert(
      bobNotifsAfterCreation.data.total >= 1 &&
      bobNotifsAfterCreation.data.page === 1 &&
      Array.isArray(bobNotifsAfterCreation.data.notifications),
      '3. Notification retrieval with pagination metadata'
    );

    // ── 4. Unread Count ───────────────────────────────────────────────────
    const unreadCountRes = await request('/notifications/unread-count', { method: 'GET', ...bobAuth });
    assert(
      unreadCountRes.status === 200 && unreadCountRes.data.unreadCount >= 1,
      '4. Unread notification count endpoint'
    );

    // ── 5. Mark One as Read ───────────────────────────────────────────────
    const notifToMark = bobNotifsAfterCreation.data.notifications[0]._id;
    const markReadRes = await request(`/notifications/${notifToMark}/read`, { method: 'PUT', ...bobAuth });
    assert(
      markReadRes.status === 200 && markReadRes.data.notification.isRead === true,
      '5. Mark single notification as read'
    );

    // Verify unread count decremented
    const unreadAfterMark = await request('/notifications/unread-count', { method: 'GET', ...bobAuth });
    assert(unreadAfterMark.data.unreadCount === unreadCountRes.data.unreadCount - 1, '5b. Unread count decremented');

    // ── 6. Mark All as Read ───────────────────────────────────────────────
    // Create second user Charlie to generate another proposal and unread notification
    const regCharlie = await request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: 'Charlie Test', email: `charlie_${timestamp}@test.edu`, password: 'password123' }),
    });
    const charlieToken = regCharlie.data.token;
    const charlieAuth  = { headers: { Authorization: `Bearer ${charlieToken}` } };

    await request('/swap', {
      method: 'POST',
      ...charlieAuth,
      body: JSON.stringify({ toUser: bobId, offeredSkill: 'Music', wantedSkill: 'React' }),
    });

    const markAllRes = await request('/notifications/read-all', { method: 'PUT', ...bobAuth });
    assert(markAllRes.status === 200 && markAllRes.data.success === true, '6. Mark all notifications as read');

    const countAfterMarkAll = await request('/notifications/unread-count', { method: 'GET', ...bobAuth });
    assert(countAfterMarkAll.data.unreadCount === 0, '6b. All notifications marked read (unread count = 0)');

    // ── 7. Delete Notification ────────────────────────────────────────────
    const deleteRes = await request(`/notifications/${notifToMark}`, { method: 'DELETE', ...bobAuth });
    assert(deleteRes.status === 200 && deleteRes.data.success === true, '7. Delete individual notification');

    // ── 8. Prevent Unauthorized Access ───────────────────────────────────
    // Charlie attempts to mark Bob's notification as read or delete it
    const remainingBobNotifs = await request('/notifications', { method: 'GET', ...bobAuth });
    if (remainingBobNotifs.data.notifications.length > 0) {
      const bobNotifId = remainingBobNotifs.data.notifications[0]._id;

      const unauthRead = await request(`/notifications/${bobNotifId}/read`, { method: 'PUT', ...charlieAuth });
      assert(unauthRead.status === 403, '8. Prevent unauthorized mark-read on another user\'s notification (403)');

      const unauthDelete = await request(`/notifications/${bobNotifId}`, { method: 'DELETE', ...charlieAuth });
      assert(unauthDelete.status === 403, '8b. Prevent unauthorized delete of another user\'s notification (403)');
    }

    // ── 10. Multiple Socket Connections (Two tabs for Alice) ──────────────
    const aliceSocket1 = io(SOCKET_URL, { auth: { token: aliceToken }, transports: ['websocket'] });
    const aliceSocket2 = io(SOCKET_URL, { auth: { token: aliceToken }, transports: ['websocket'] });
    socketsToClose.push(aliceSocket1, aliceSocket2);

    await Promise.all([
      new Promise(r => aliceSocket1.on('connect', r)),
      new Promise(r => aliceSocket2.on('connect', r)),
    ]);

    let s1Received = false;
    let s2Received = false;

    aliceSocket1.on('notification:new', () => { s1Received = true; });
    aliceSocket2.on('notification:new', () => { s2Received = true; });

    // Bob accepts Alice's swap request -> triggers SWAP_ACCEPTED to Alice
    const acceptRes = await request(`/swap/${swapId}/accept`, { method: 'PUT', ...bobAuth });
    assert(acceptRes.status === 200 && acceptRes.data.status === 'accepted', '12. Swap acceptance processed');

    // Wait for both tabs to receive the event
    await new Promise(resolve => setTimeout(resolve, 800));

    assert(
      s1Received && s2Received,
      '10. Multi-tab delivery: Both client sockets received real-time notification'
    );

    // Verify Alice received SWAP_ACCEPTED notification in DB
    const aliceNotifs = await request('/notifications', { method: 'GET', ...aliceAuth });
    assert(
      aliceNotifs.data.notifications.some(n => n.type === 'SWAP_ACCEPTED'),
      '12b. Swap acceptance notification stored for sender'
    );

    // ── 13. Swap Rejection Notification ──────────────────────────────────
    // Charlie proposes a swap to Alice, Alice rejects
    const proposalCA = await request('/swap', {
      method: 'POST',
      ...charlieAuth,
      body: JSON.stringify({ toUser: aliceId, offeredSkill: 'Music', wantedSkill: 'Python' }),
    });
    const swapCAId = proposalCA.data._id;

    await request(`/swap/${swapCAId}/reject`, { method: 'PUT', ...aliceAuth });

    const charlieNotifs = await request('/notifications', { method: 'GET', ...charlieAuth });
    assert(
      charlieNotifs.data.notifications.some(n => n.type === 'SWAP_REJECTED'),
      '13. Swap rejection notification sent to sender'
    );

    // ── 14. Swap Cancellation Notification ────────────────────────────────
    // Dave proposes a swap to Alice, Dave cancels
    const regDave = await request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: 'Dave Test', email: `dave_${timestamp}@test.edu`, password: 'password123' }),
    });
    const daveToken = regDave.data.token;
    const daveAuth  = { headers: { Authorization: `Bearer ${daveToken}` } };

    const proposalDave = await request('/swap', {
      method: 'POST',
      ...daveAuth,
      body: JSON.stringify({ toUser: aliceId, offeredSkill: 'Guitar', wantedSkill: 'Python' }),
    });
    assert(proposalDave.status === 201, '14a. Proposal from Dave created');
    const swapDaveId = proposalDave.data._id;

    await request(`/swap/${swapDaveId}/cancel`, {
      method: 'PUT',
      ...daveAuth,
      body: JSON.stringify({ reason: 'Timetable conflict' }),
    });

    const aliceNotifsAfterCancel = await request('/notifications', { method: 'GET', ...aliceAuth });
    assert(
      aliceNotifsAfterCancel.data.notifications.some(n => n.type === 'SWAP_CANCELLED'),
      '14. Swap cancellation notification delivered to recipient'
    );

    // ── 15. Session Scheduling Notification ───────────────────────────────
    const scheduledTime = new Date(Date.now() + 20 * 60 * 1000).toISOString(); // 20 mins from now
    const scheduleRes = await request(`/swap/${swapId}/schedule`, {
      method: 'PUT',
      ...bobAuth,
      body: JSON.stringify({ scheduledAt: scheduledTime }),
    });
    assert(scheduleRes.status === 200, '15. Session scheduled successfully');

    const aliceNotifsAfterSchedule = await request('/notifications', { method: 'GET', ...aliceAuth });
    assert(
      aliceNotifsAfterSchedule.data.notifications.some(n => n.type === 'SESSION_SCHEDULED'),
      '15b. Session scheduling notification delivered to partner'
    );

    // ── 16. Session Reminder Delivery & Scheduler ─────────────────────────
    await checkUpcomingSessionReminders();

    const aliceNotifsAfterReminder = await request('/notifications', { method: 'GET', ...aliceAuth });
    const bobNotifsAfterReminder   = await request('/notifications', { method: 'GET', ...bobAuth });

    const aliceGotReminder = aliceNotifsAfterReminder.data.notifications.some(n => n.type === 'SESSION_REMINDER');
    const bobGotReminder   = bobNotifsAfterReminder.data.notifications.some(n => n.type === 'SESSION_REMINDER');

    assert(aliceGotReminder && bobGotReminder, '16. Session reminder delivered to both participants (< 30m window)');

    // ── 17. Duplicate Reminder Prevention ────────────────────────────────
    const aliceReminderCountBefore = aliceNotifsAfterReminder.data.notifications.filter(n => n.type === 'SESSION_REMINDER').length;
    // Run reminder check again immediately
    await checkUpcomingSessionReminders();
    const aliceNotifsAfterSecondCheck = await request('/notifications', { method: 'GET', ...aliceAuth });
    const aliceReminderCountAfter = aliceNotifsAfterSecondCheck.data.notifications.filter(n => n.type === 'SESSION_REMINDER').length;

    assert(
      aliceReminderCountBefore === aliceReminderCountAfter,
      '17. Duplicate reminder prevention verified (no duplicate reminders created)'
    );

    // ── 18. No Reminder for Cancelled or Completed Swaps ──────────────────
    // Complete swapId
    await request(`/swap/${swapId}/complete`, { method: 'PUT', ...aliceAuth });
    const notifsBeforeCompletedCheck = await request('/notifications', { method: 'GET', ...aliceAuth });
    await checkUpcomingSessionReminders();
    const notifsAfterCompletedCheck = await request('/notifications', { method: 'GET', ...aliceAuth });

    assert(
      notifsBeforeCompletedCheck.data.total === notifsAfterCompletedCheck.data.total,
      '18. No reminders triggered for completed or cancelled swaps'
    );

    // ── 19. Socket Reconnection ───────────────────────────────────────────
    let reconnectedReceived = false;
    bobSocket.disconnect();

    // Reconnect socket
    bobSocket.connect();
    await new Promise(r => bobSocket.on('connect', r));

    const reconnectPromise = new Promise(resolve => {
      bobSocket.on('notification:new', (notif) => {
        if (notif.message.includes('Eve') || notif.title.includes('Swap Request')) {
          reconnectedReceived = true;
          resolve(notif);
        }
      });
    });

    // Trigger an API request that emits a notification from server.js
    const regEve = await request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: 'Eve Reconnection', email: `eve_${timestamp}@test.edu`, password: 'password123' }),
    });
    const eveToken = regEve.data.token;
    const eveAuth  = { headers: { Authorization: `Bearer ${eveToken}` } };

    await request('/swap', {
      method: 'POST',
      ...eveAuth,
      body: JSON.stringify({
        toUser: bobId,
        offeredSkill: 'Cloud Computing',
        wantedSkill: 'React',
        compatibilityNote: 'Reconnection test note',
      }),
    });

    await Promise.race([
      reconnectPromise,
      new Promise(r => setTimeout(r, 1500)),
    ]);

    assert(reconnectedReceived, '19. Socket reconnection verified (receives events after reconnect)');

    // ── 20. Existing Phase 1 Regression Tests ─────────────────────────────
    // Register -> Login -> Profile -> Availability -> Match -> Swap -> Rating
    const regPhase1 = await request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: 'Phase1 Check', email: `phase1_${timestamp}@test.edu`, password: 'password123' }),
    });
    assert(regPhase1.status === 201 && regPhase1.data.token, '20a. Phase 1 Auth registration regression check');

    const matchPhase1 = await request('/match', {
      method: 'GET',
      headers: { Authorization: `Bearer ${regPhase1.data.token}` },
    });
    assert(matchPhase1.status === 200, '20b. Phase 1 Matching endpoint regression check');

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📊 TEST RESULTS: ${passed} PASSED | ${failed} FAILED`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    for (const s of socketsToClose) {
      s.disconnect();
    }
    await mongoose.disconnect();

    process.exit(failed > 0 ? 1 : 0);
  } catch (error) {
    console.error('Test execution error:', error);
    for (const s of socketsToClose) {
      s.disconnect();
    }
    try { await mongoose.disconnect(); } catch (e) {}
    process.exit(1);
  }
}

runTests();
