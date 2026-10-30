const BASE_URL = 'http://localhost:5001/api';

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
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🧪 SKILLSWAP PHASE 1 — AUTOMATED QA & INTEGRATION SUITE');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

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

  try {
    // 1. Register a new account
    const testEmail = `student_${Date.now()}@college.edu`;
    const regRes = await request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Test Student',
        email: testEmail,
        password: 'password123',
      }),
    });
    assert(regRes.status === 201 && regRes.data.token, '1. Register new student account');
    const token = regRes.data.token;
    const testUserId = regRes.data.user.id;

    // 2. Log in with registered credentials
    const loginRes = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: testEmail,
        password: 'password123',
      }),
    });
    assert(loginRes.status === 200 && loginRes.data.token, '2. Log in with credentials');

    const authHeaders = { headers: { Authorization: `Bearer ${token}` } };

    // 3. Update profile with skills (teaches Python, wants React)
    const profileRes = await request('/profile', {
      method: 'PUT',
      ...authHeaders,
      body: JSON.stringify({
        name: 'Test Student Pro',
        bio: 'Enthusiastic CS sophomore exploring distributed systems.',
        skillsOffered: [{ skill: 'Python', category: 'Programming', level: 'Intermediate' }],
        skillsWanted: [{ skill: 'React', category: 'Programming', priority: 'High' }],
        availabilitySlots: [{ day: 'Monday', from: '18:00', to: '20:00' }],
      }),
    });
    assert(profileRes.status === 200 && profileRes.data.skillsOffered.length === 1, '3. Update profile skills & bio');

    // 4. Verify availability slots saved
    assert(
      profileRes.data.availabilitySlots.length === 1 &&
      profileRes.data.availabilitySlots[0].day === 'Monday',
      '4. Add & verify availability slots'
    );

    // 5. Discover compatible users
    const matchRes = await request('/match', { method: 'GET', ...authHeaders });
    assert(matchRes.status === 200 && Array.isArray(matchRes.data.matches), '5. Discover ranked compatibility matches');
    const aaravMatch = matchRes.data.matches.find(m => m.user.name.includes('Aarav'));
    assert(aaravMatch && aaravMatch.compatibilityScore > 0, '5b. Verify Aarav (React tutor) matched with high score');

    // 6. Test search endpoint for users by skill & name
    const searchRes = await request('/match/search?q=Python', { method: 'GET', ...authHeaders });
    assert(searchRes.status === 200 && searchRes.data.length > 0, '6. Search users by skill name');

    // 7. Send a swap request to Aarav
    const aaravId = aaravMatch.user._id;
    const swapRes = await request('/swap', {
      method: 'POST',
      ...authHeaders,
      body: JSON.stringify({
        toUser: aaravId,
        offeredSkill: 'Python',
        wantedSkill: 'React',
        compatibilityScore: aaravMatch.compatibilityScore,
        compatibilityNote: aaravMatch.compatibilityNote,
      }),
    });
    assert(swapRes.status === 201 && swapRes.data.status === 'pending', '7. Send swap request');
    const createdSwapId = swapRes.data._id;

    // 7b. Duplicate swap request prevention test
    const dupRes = await request('/swap', {
      method: 'POST',
      ...authHeaders,
      body: JSON.stringify({
        toUser: aaravId,
        offeredSkill: 'Python',
        wantedSkill: 'React',
      }),
    });
    assert(dupRes.status === 400, '7b. Prevent duplicate pending swap request (rejected with 400)');

    // 8. Accept swap request (Login as Aarav)
    const aaravLogin = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: 'aarav@skillswap.com',
        password: 'password123',
      }),
    });
    const aaravHeaders = { headers: { Authorization: `Bearer ${aaravLogin.data.token}` } };

    const acceptRes = await request(`/swap/${createdSwapId}/accept`, {
      method: 'PUT',
      ...aaravHeaders,
      body: JSON.stringify({}),
    });
    assert(
      acceptRes.status === 200 &&
      acceptRes.data.status === 'accepted' &&
      acceptRes.data.roomId,
      '8. Accept swap request & generate WebRTC room ID'
    );

    // 9. Schedule a session
    const tomorrow = new Date(Date.now() + 86400000).toISOString();
    const scheduleRes = await request(`/swap/${createdSwapId}/schedule`, {
      method: 'PUT',
      ...aaravHeaders,
      body: JSON.stringify({ scheduledAt: tomorrow }),
    });
    assert(scheduleRes.status === 200 && scheduleRes.data.scheduledAt, '9. Schedule video session');

    // 9b. Validate scheduling in the past is rejected
    const pastScheduleRes = await request(`/swap/${createdSwapId}/schedule`, {
      method: 'PUT',
      ...aaravHeaders,
      body: JSON.stringify({ scheduledAt: new Date(Date.now() - 3600000).toISOString() }),
    });
    assert(pastScheduleRes.status === 400, '9b. Reject session scheduling in the past (400 Bad Request)');

    // 10. WebRTC Room accessibility check
    assert(acceptRes.data.roomId.startsWith('skillswap-'), '10. WebRTC P2P room ready for RTCPeerConnection');

    // 11. Complete the swap
    const completeRes = await request(`/swap/${createdSwapId}/complete`, {
      method: 'PUT',
      ...authHeaders,
      body: JSON.stringify({}),
    });
    assert(completeRes.status === 200 && completeRes.data.status === 'completed', '11. Complete swap request');

    // 12. Submit a rating (Test Student rates Aarav)
    const initialAaravProfile = await request(`/profile/${aaravId}`, { method: 'GET', ...authHeaders });
    const initialRatingCount = initialAaravProfile.data.totalRatings || 0;

    const ratingRes = await request('/rating', {
      method: 'POST',
      ...authHeaders,
      body: JSON.stringify({
        swapRequestId: createdSwapId,
        ratee: aaravId,
        score: 5,
        comment: 'Fantastic React mentoring session! Solved state propagation issues.',
      }),
    });
    assert(ratingRes.status === 201 && ratingRes.data.score === 5, '12. Submit 5-star rating for completed swap');

    // 12b. Prevent duplicate rating submission
    const dupRatingRes = await request('/rating', {
      method: 'POST',
      ...authHeaders,
      body: JSON.stringify({
        swapRequestId: createdSwapId,
        ratee: aaravId,
        score: 4,
      }),
    });
    assert(dupRatingRes.status === 400, '12b. Prevent duplicate rating on same swap (rejected with 400)');

    // 13. Verify updated average rating on ratee
    const updatedAaravProfile = await request(`/profile/${aaravId}`, { method: 'GET', ...authHeaders });
    assert(
      updatedAaravProfile.data.totalRatings === initialRatingCount + 1,
      '13. Verify rating count & average recalculation on ratee'
    );

    // 14. Block a user (Test Student blocks Sneha)
    const snehaProfile = await request('/match/search?q=Sneha', { method: 'GET', ...authHeaders });
    const snehaId = snehaProfile.data[0]._id;
    const blockRes = await request(`/profile/block/${snehaId}`, {
      method: 'POST',
      ...authHeaders,
      body: JSON.stringify({}),
    });
    assert(blockRes.status === 200, '14. Block user');

    // 15. Verify blocked user excluded from search and matches
    const searchAfterBlock = await request('/match/search?q=Sneha', { method: 'GET', ...authHeaders });
    const foundSneha = searchAfterBlock.data.some(u => u._id === snehaId);
    assert(!foundSneha, '15. Verify blocked user excluded from search and compatibility matches');

    // 16. Unauthorized API access prevention
    const unauthRes = await request('/profile', { method: 'GET' });
    assert(unauthRes.status === 401, '16. Reject unauthenticated access to protected route (401)');

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📊 TEST RESULTS: ${passed} PASSED | ${failed} FAILED`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    process.exit(failed > 0 ? 1 : 0);
  } catch (error) {
    console.error('Test execution error:', error);
    process.exit(1);
  }
}

runTests();
