/**
 * Phase 5 — Intelligent Recommendation Engine Tests
 * 27 tests covering: auth, empty profile, forward/reverse match,
 * priority weighting, verification boost, rating signal,
 * already-connected filter, blocked user filter, score ordering,
 * skill suggestions, dashboard endpoint, self-exclusion, and data privacy.
 */

'use strict';

require('dotenv').config();
const http = require('http');
const assert = require('assert');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// ── Import models ──────────────────────────────────────────────────────────────
const User             = require('./models/User');
const SwapRequest      = require('./models/SwapRequest');
const Endorsement      = require('./models/Endorsement');
const Rating           = require('./models/Rating');
const SkillVerification = require('./models/SkillVerification');
const { app }          = require('./server');

// ── Test harness ───────────────────────────────────────────────────────────────
let server;
let BASE_URL;
let passed = 0;
let failed = 0;
const failures = [];

async function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const bodyStr = body ? JSON.stringify(body) : undefined;
    const options = {
      hostname: url.hostname,
      port:     url.port,
      path:     url.pathname + url.search,
      method:   method.toUpperCase(),
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
    };

    const req = http.request(options, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, data: parsed });
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ❌ ${name}: ${err.message}`);
    failed++;
    failures.push({ name, error: err.message });
  }
}

function makeToken(id) {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

// ── Test users & fixture helpers ──────────────────────────────────────────────
const EMAIL = (tag) => `phase5_${tag}_${Date.now()}@test.skillswap`;
const PASS  = 'testpass123';

async function createUser(overrides = {}) {
  const hashed = await bcrypt.hash(PASS, 10);
  const user = new User({
    name:     overrides.name     || 'Phase5 Test User',
    email:    overrides.email    || EMAIL(Math.random().toString(36).slice(2)),
    password: hashed,
    skillsOffered:  overrides.skillsOffered  || [],
    skillsWanted:   overrides.skillsWanted   || [],
    availabilitySlots: overrides.availabilitySlots || [],
    averageRating:  overrides.averageRating  ?? 0,
    totalRatings:   overrides.totalRatings   ?? 0,
    role:           overrides.role           || 'student',
    blockedUsers:   overrides.blockedUsers   || [],
  });
  await user.save();
  return user;
}

async function addVerification(userId, skillName, status = 'verified') {
  const v = new SkillVerification({
    user:         userId,
    skillName,
    category:     'Programming',
    evidenceType: 'certificate',
    description:  'Test certificate',
    status,
  });
  await v.save();
  return v;
}

// ── Cleanup set ───────────────────────────────────────────────────────────────
const createdUserIds = [];
const createdSwapIds = [];
const createdVerifIds = [];
const createdEndorseIds = [];

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  // Connect DB
  await mongoose.connect(process.env.MONGO_URI, { dbName: 'skillswap' });

  // Start server
  await new Promise(resolve => {
    server = app.listen(0, () => {
      BASE_URL = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });

  console.log('\n═══════════════════════════════════════════════════');
  console.log('  Phase 5 — Recommendation Engine Tests (27 tests)');
  console.log('═══════════════════════════════════════════════════\n');

  // ── GROUP 1: Authentication guard (2 tests) ─────────────────────────────────
  console.log('── Group 1: Authentication Guard ──');

  await test('GET /api/recommendations/partners without token returns 401', async () => {
    const res = await request('GET', '/api/recommendations/partners', null, null);
    assert.strictEqual(res.status, 401);
  });

  await test('GET /api/recommendations/skills without token returns 401', async () => {
    const res = await request('GET', '/api/recommendations/skills', null, null);
    assert.strictEqual(res.status, 401);
  });

  // ── GROUP 2: Empty profile (2 tests) ────────────────────────────────────────
  console.log('\n── Group 2: Empty Profile Graceful Handling ──');

  const emptyUser = await createUser({ name: 'Empty Profile User', skillsOffered: [], skillsWanted: [] });
  createdUserIds.push(emptyUser._id);
  const emptyToken = makeToken(emptyUser._id);

  await test('Empty profile returns 200 with empty recommendations array', async () => {
    const res = await request('GET', '/api/recommendations/partners', null, emptyToken);
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.data.recommendations), 'recommendations should be array');
    assert.strictEqual(res.data.recommendations.length, 0);
  });

  await test('Empty profile meta.profileCompleteness is "empty"', async () => {
    const res = await request('GET', '/api/recommendations/partners', null, emptyToken);
    assert.strictEqual(res.data.meta.profileCompleteness, 'empty');
    assert.ok(res.data.meta.message, 'Should include a helpful message');
  });

  // ── GROUP 3: Forward-only match (2 tests) ───────────────────────────────────
  console.log('\n── Group 3: Forward-Only Match ──');

  // Use a unique skill name to avoid collision with production seed data users
  const UNIQUE_FWD_SKILL = `UniqueSkillFwd_${Date.now()}`;

  const forwardSeeker = await createUser({
    name: 'Forward Seeker',
    skillsWanted: [{ skill: UNIQUE_FWD_SKILL, category: 'Programming', priority: 'High' }],
    skillsOffered: [],
  });
  createdUserIds.push(forwardSeeker._id);
  const fwdToken = makeToken(forwardSeeker._id);

  const reactTeacher = await createUser({
    name: 'React Teacher',
    skillsOffered: [{ skill: UNIQUE_FWD_SKILL, category: 'Programming', level: 'Advanced' }],
    skillsWanted: [],
  });
  createdUserIds.push(reactTeacher._id);

  await test('User with only skillsWanted gets forward-match recommendations', async () => {
    const res = await request('GET', '/api/recommendations/partners', null, fwdToken);
    assert.strictEqual(res.status, 200);
    const names = res.data.recommendations.map(r => r.user.name);
    assert.ok(names.includes('React Teacher'), 'React Teacher should appear in recommendations');
  });

  await test('Forward-match recommendation has matchedWants populated', async () => {
    const res = await request('GET', '/api/recommendations/partners', null, fwdToken);
    const rec = res.data.recommendations.find(r => r.user.name === 'React Teacher');
    assert.ok(rec, 'React Teacher must be in recommendations');
    assert.ok(rec.matchedWants.length > 0, 'matchedWants should not be empty');
    assert.ok(
      rec.matchedWants.map(s => s.toLowerCase()).includes(UNIQUE_FWD_SKILL.toLowerCase()),
      `matchedWants should include ${UNIQUE_FWD_SKILL}`
    );
  });

  // ── GROUP 4: Reverse-only match (2 tests) ───────────────────────────────────
  console.log('\n── Group 4: Reverse-Only Match ──');

  // Use unique skill names to avoid collision with seeded production data
  const UNIQUE_DESIGN_SKILL  = `UniqueDesign_${Date.now()}`;
  const UNIQUE_PYTHON_SKILL  = `UniquePython_${Date.now()}`;

  const reverseTeacher = await createUser({
    name: 'Reverse Teacher',
    skillsOffered: [{ skill: UNIQUE_PYTHON_SKILL, category: 'Programming', level: 'Advanced' }],
    skillsWanted: [],
  });
  createdUserIds.push(reverseTeacher._id);

  const reverseStudent = await createUser({
    name: 'Python Seeker',
    skillsOffered: [],
    skillsWanted:  [{ skill: UNIQUE_PYTHON_SKILL, category: 'Programming', priority: 'High' }],
  });
  createdUserIds.push(reverseStudent._id);

  // reverseTeacher wants nothing but reverseStudent offers Python — reverse signal
  const reverseOfferUser = await createUser({
    name: 'Python Offer Reverse',
    skillsOffered: [{ skill: UNIQUE_PYTHON_SKILL, category: 'Programming', level: 'Intermediate' }],
    skillsWanted:  [{ skill: UNIQUE_DESIGN_SKILL, category: 'Design', priority: 'Medium' }],
  });
  createdUserIds.push(reverseOfferUser._id);

  const designTeacher = await createUser({
    name: 'Design Teacher For Reverse',
    skillsOffered: [{ skill: UNIQUE_DESIGN_SKILL, category: 'Design', level: 'Advanced' }],
    skillsWanted:  [{ skill: UNIQUE_PYTHON_SKILL, category: 'Programming', priority: 'High' }],
  });
  createdUserIds.push(designTeacher._id);
  const designTeacherToken = makeToken(designTeacher._id);

  await test('User with only skillsOffered gets reverse-match recommendations', async () => {
    const res = await request('GET', '/api/recommendations/partners', null, designTeacherToken);
    assert.strictEqual(res.status, 200);
    // designTeacher offers UNIQUE_DESIGN_SKILL; reverseOfferUser wants UNIQUE_DESIGN_SKILL → reverse match
    const names = res.data.recommendations.map(r => r.user.name);
    assert.ok(names.includes('Python Offer Reverse'), 'Reverse match candidate should appear');
  });

  await test('Reverse-match recommendation has matchedOffers populated', async () => {
    const res = await request('GET', '/api/recommendations/partners', null, designTeacherToken);
    const rec = res.data.recommendations.find(r => r.user.name === 'Python Offer Reverse');
    assert.ok(rec, 'Reverse match candidate must be present');
    assert.ok(rec.matchedOffers.length > 0, 'matchedOffers should not be empty');
  });

  // ── GROUP 5: Priority weighting (3 tests) ───────────────────────────────────
  console.log('\n── Group 5: Priority Weighting ──');

  // Use unique skill names to avoid pollution from seed data
  const PRIO_TS_SKILL    = `UniquePrioTS_${Date.now()}`;
  const PRIO_FIGMA_SKILL = `UniquePrioFigma_${Date.now()}`;

  const prioritySeeker = await createUser({
    name: 'Priority Seeker',
    skillsWanted: [
      { skill: PRIO_TS_SKILL,    category: 'Programming', priority: 'High' },
      { skill: PRIO_FIGMA_SKILL, category: 'Design',      priority: 'Low'  },
    ],
    skillsOffered: [],
  });
  createdUserIds.push(prioritySeeker._id);
  const prioToken = makeToken(prioritySeeker._id);

  const tsTeacher = await createUser({
    name: 'TypeScript Teacher (High Prio)',
    skillsOffered: [{ skill: PRIO_TS_SKILL, category: 'Programming', level: 'Advanced' }],
    skillsWanted: [],
  });
  createdUserIds.push(tsTeacher._id);

  const figmaTeacher = await createUser({
    name: 'Figma Teacher (Low Prio)',
    skillsOffered: [{ skill: PRIO_FIGMA_SKILL, category: 'Design', level: 'Intermediate' }],
    skillsWanted: [],
  });
  createdUserIds.push(figmaTeacher._id);

  await test('High-priority want produces higher forward score than Low-priority want', async () => {
    const res = await request('GET', '/api/recommendations/partners', null, prioToken);
    assert.strictEqual(res.status, 200);
    const tsRec    = res.data.recommendations.find(r => r.user.name === 'TypeScript Teacher (High Prio)');
    const figmaRec = res.data.recommendations.find(r => r.user.name === 'Figma Teacher (Low Prio)');
    assert.ok(tsRec,    'TypeScript Teacher must appear');
    assert.ok(figmaRec, 'Figma Teacher must appear');
    assert.ok(
      tsRec.scoreBreakdown.forwardMatch > figmaRec.scoreBreakdown.forwardMatch,
      `TypeScript forward (${tsRec.scoreBreakdown.forwardMatch}) must beat Figma forward (${figmaRec.scoreBreakdown.forwardMatch})`
    );
  });

  await test('High-priority recommendation appears before Low-priority in sorted results', async () => {
    const res = await request('GET', '/api/recommendations/partners', null, prioToken);
    const recs  = res.data.recommendations;
    const tsIdx    = recs.findIndex(r => r.user.name === 'TypeScript Teacher (High Prio)');
    const figmaIdx = recs.findIndex(r => r.user.name === 'Figma Teacher (Low Prio)');
    assert.ok(tsIdx !== -1 && figmaIdx !== -1, 'Both must be present');
    assert.ok(tsIdx < figmaIdx, `TypeScript (idx ${tsIdx}) should rank above Figma (idx ${figmaIdx})`);
  });

  await test('Score breakdown sums are within expected weight bounds', async () => {
    const res = await request('GET', '/api/recommendations/partners', null, prioToken);
    for (const rec of res.data.recommendations) {
      const bd = rec.scoreBreakdown;
      const sum = Object.values(bd).reduce((a, b) => a + b, 0);
      // Rounding can cause sum to exceed 100 by 1–2; score is clamped to 100
      assert.ok(rec.score >= 0 && rec.score <= 100, `Score ${rec.score} out of [0,100]`);
      assert.ok(sum >= 0 && sum <= 102, `Breakdown sum ${sum} out of expected range`);
    }
  });

  // ── GROUP 6: Skill verification boost (2 tests) ─────────────────────────────
  console.log('\n── Group 6: Verification Boost ──');

  const VERIFY_SKILL = `UniqueVerify_${Date.now()}`;

  const verifySeeker = await createUser({
    name: 'Verify Seeker',
    skillsWanted: [{ skill: VERIFY_SKILL, category: 'Programming', priority: 'High' }],
    skillsOffered: [],
  });
  createdUserIds.push(verifySeeker._id);
  const verifyToken = makeToken(verifySeeker._id);

  const verifiedNodeTeacher = await createUser({
    name: 'Verified Node Teacher',
    skillsOffered: [{ skill: VERIFY_SKILL, category: 'Programming', level: 'Advanced', verified: true }],
    skillsWanted: [],
  });
  createdUserIds.push(verifiedNodeTeacher._id);

  const unverifiedNodeTeacher = await createUser({
    name: 'Unverified Node Teacher',
    skillsOffered: [{ skill: VERIFY_SKILL, category: 'Programming', level: 'Advanced', verified: false }],
    skillsWanted: [],
  });
  createdUserIds.push(unverifiedNodeTeacher._id);

  // Create admin-approved SkillVerification record for verifiedNodeTeacher
  const vRecord = await addVerification(verifiedNodeTeacher._id, VERIFY_SKILL, 'verified');
  createdVerifIds.push(vRecord._id);

  // Create pending (non-approved) record for unverifiedNodeTeacher — should NOT count
  const vPending = await addVerification(unverifiedNodeTeacher._id, VERIFY_SKILL, 'pending');
  createdVerifIds.push(vPending._id);

  await test('Admin-verified teacher has higher verificationBoost than unverified teacher', async () => {
    const res = await request('GET', '/api/recommendations/partners', null, verifyToken);
    const verifiedRec   = res.data.recommendations.find(r => r.user.name === 'Verified Node Teacher');
    const unverifiedRec = res.data.recommendations.find(r => r.user.name === 'Unverified Node Teacher');
    assert.ok(verifiedRec,   'Verified teacher must appear');
    assert.ok(unverifiedRec, 'Unverified teacher must appear');
    assert.ok(
      verifiedRec.scoreBreakdown.verificationBoost > unverifiedRec.scoreBreakdown.verificationBoost,
      `Verified boost (${verifiedRec.scoreBreakdown.verificationBoost}) must exceed unverified (${unverifiedRec.scoreBreakdown.verificationBoost})`
    );
  });

  await test('Pending SkillVerification does not contribute to verificationBoost', async () => {
    const res = await request('GET', '/api/recommendations/partners', null, verifyToken);
    const unverifiedRec = res.data.recommendations.find(r => r.user.name === 'Unverified Node Teacher');
    assert.ok(unverifiedRec, 'Unverified teacher must appear');
    assert.strictEqual(unverifiedRec.scoreBreakdown.verificationBoost, 0,
      'Pending verification should not boost score');
  });

  // ── GROUP 7: Rating signal (2 tests) ────────────────────────────────────────
  console.log('\n── Group 7: Rating Signal ──');

  const RATING_SKILL = `UniqueRating_${Date.now()}`;

  const ratingSeeker = await createUser({
    name: 'Rating Seeker',
    skillsWanted: [{ skill: RATING_SKILL, category: 'Database', priority: 'High' }],
    skillsOffered: [],
  });
  createdUserIds.push(ratingSeeker._id);
  const ratingToken = makeToken(ratingSeeker._id);

  const highRatedTeacher = await createUser({
    name: 'High Rated Teacher',
    skillsOffered: [{ skill: RATING_SKILL, category: 'Database', level: 'Advanced' }],
    skillsWanted: [],
    averageRating: 4.8,
    totalRatings: 20,
  });
  createdUserIds.push(highRatedTeacher._id);

  const unratedTeacher = await createUser({
    name: 'Unrated Teacher',
    skillsOffered: [{ skill: RATING_SKILL, category: 'Database', level: 'Advanced' }],
    skillsWanted: [],
    averageRating: 0,
    totalRatings: 0,
  });
  createdUserIds.push(unratedTeacher._id);

  await test('High-rated teacher has higher ratingScore than unrated teacher', async () => {
    const res = await request('GET', '/api/recommendations/partners', null, ratingToken);
    const highRec   = res.data.recommendations.find(r => r.user.name === 'High Rated Teacher');
    const unratedRec = res.data.recommendations.find(r => r.user.name === 'Unrated Teacher');
    assert.ok(highRec,    'High rated teacher must appear');
    assert.ok(unratedRec, 'Unrated teacher must appear');
    assert.ok(
      highRec.scoreBreakdown.ratingScore > unratedRec.scoreBreakdown.ratingScore,
      `High rated score (${highRec.scoreBreakdown.ratingScore}) must exceed unrated (${unratedRec.scoreBreakdown.ratingScore})`
    );
  });

  await test('Unrated teacher still appears in results (no unfair penalty)', async () => {
    const res = await request('GET', '/api/recommendations/partners', null, ratingToken);
    const unratedRec = res.data.recommendations.find(r => r.user.name === 'Unrated Teacher');
    assert.ok(unratedRec, 'Unrated teacher must still appear — no penalty for zero ratings');
    assert.ok(unratedRec.scoreBreakdown.ratingScore >= 0, 'Rating score must not be negative');
  });

  // ── GROUP 8: Already-connected filter (2 tests) ─────────────────────────────
  console.log('\n── Group 8: Already-Connected User Filter ──');

  const CONN_SKILL    = `UniqueConn_${Date.now()}`;
  const BLOCKED_SKILL = `UniqueBlocked_${Date.now()}`;

  const connectedSeeker = await createUser({
    name: 'Connected Seeker',
    skillsWanted: [{ skill: CONN_SKILL, category: 'DevOps', priority: 'High' }],
    skillsOffered: [],
  });
  createdUserIds.push(connectedSeeker._id);
  const connToken = makeToken(connectedSeeker._id);

  const pendingConnectedUser = await createUser({
    name: 'Already Pending Partner',
    skillsOffered: [{ skill: CONN_SKILL, category: 'DevOps', level: 'Advanced' }],
    skillsWanted: [],
  });
  createdUserIds.push(pendingConnectedUser._id);

  // Create a pending swap between connectedSeeker and pendingConnectedUser
  const pendingSwap = new SwapRequest({
    fromUser:     connectedSeeker._id,
    toUser:       pendingConnectedUser._id,
    offeredSkill: 'Nothing',
    wantedSkill:  'Docker',
    status:       'pending',
  });
  await pendingSwap.save();
  createdSwapIds.push(pendingSwap._id);

  await test('User with pending swap still appears but alreadyConnected=true', async () => {
    const res = await request('GET', '/api/recommendations/partners', null, connToken);
    const rec = res.data.recommendations.find(r => r.user.name === 'Already Pending Partner');
    assert.ok(rec, 'Connected partner must still appear in results');
    assert.strictEqual(rec.alreadyConnected, true, 'alreadyConnected must be true');
  });

  await test('Non-connected teacher with same skill has alreadyConnected=false', async () => {
    const freeDockerTeacher = await createUser({
      name: 'Free Docker Teacher',
      skillsOffered: [{ skill: CONN_SKILL, category: 'DevOps', level: 'Intermediate' }],
      skillsWanted: [],
    });
    createdUserIds.push(freeDockerTeacher._id);
    const res = await request('GET', '/api/recommendations/partners', null, connToken);
    const rec = res.data.recommendations.find(r => r.user.name === 'Free Docker Teacher');
    assert.ok(rec, 'Free Docker teacher must appear');
    assert.strictEqual(rec.alreadyConnected, false, 'alreadyConnected must be false');
  });

  // ── GROUP 9: Blocked user filter (2 tests) ──────────────────────────────────
  console.log('\n── Group 9: Blocked User Filter ──');

  // BLOCKED_SKILL already declared in Group 8 scope above
  const blockerUser = await createUser({ name: 'Blocker User', skillsWanted: [{ skill: BLOCKED_SKILL, category: 'Programming', priority: 'High' }] });
  createdUserIds.push(blockerUser._id);

  const blockedTeacher = await createUser({
    name: 'Blocked GraphQL Teacher',
    skillsOffered: [{ skill: BLOCKED_SKILL, category: 'Programming', level: 'Advanced' }],
  });
  createdUserIds.push(blockedTeacher._id);

  // blockerUser blocks blockedTeacher
  await User.findByIdAndUpdate(blockerUser._id, { $push: { blockedUsers: blockedTeacher._id } });
  const blockerToken = makeToken(blockerUser._id);

  await test('Blocked teacher does not appear in recommendations', async () => {
    const res = await request('GET', '/api/recommendations/partners', null, blockerToken);
    const names = res.data.recommendations.map(r => r.user.name);
    assert.ok(!names.includes('Blocked GraphQL Teacher'), 'Blocked teacher must be excluded');
  });

  await test('User who blocked the seeker does not appear in recommendations', async () => {
    // Create a user who has blocked blockerUser in their blockedUsers list
    const reverseBlocker = await createUser({
      name: 'Reverse Blocker Teacher',
      skillsOffered: [{ skill: BLOCKED_SKILL, category: 'Programming', level: 'Advanced' }],
      blockedUsers: [blockerUser._id],
    });
    createdUserIds.push(reverseBlocker._id);
    const res = await request('GET', '/api/recommendations/partners', null, blockerToken);
    const names = res.data.recommendations.map(r => r.user.name);
    assert.ok(!names.includes('Reverse Blocker Teacher'), 'User who blocked seeker must be excluded');
  });

  // ── GROUP 10: Score ordering (1 test) ───────────────────────────────────────
  console.log('\n── Group 10: Score Ordering ──');

  await test('Recommendations are sorted by score descending', async () => {
    const seeker = await createUser({
      name: 'Order Seeker',
      skillsWanted: [{ skill: 'React', category: 'Programming', priority: 'High' }],
    });
    createdUserIds.push(seeker._id);
    const seekerToken = makeToken(seeker._id);
    const res = await request('GET', '/api/recommendations/partners', null, seekerToken);
    const scores = res.data.recommendations.map(r => r.score);
    for (let i = 1; i < scores.length; i++) {
      assert.ok(scores[i - 1] >= scores[i], `Score at ${i-1} (${scores[i-1]}) must be ≥ score at ${i} (${scores[i]})`);
    }
  });

  // ── GROUP 11: Skill suggestions (2 tests) ───────────────────────────────────
  console.log('\n── Group 11: Skill Suggestions Endpoint ──');

  const suggestionUser = await createUser({
    name: 'Suggestion Seeker',
    skillsOffered: [{ skill: 'JavaScript', category: 'Programming', level: 'Intermediate' }],
    skillsWanted:  [{ skill: 'React', category: 'Programming', priority: 'High' }],
  });
  createdUserIds.push(suggestionUser._id);
  const suggToken = makeToken(suggestionUser._id);

  await test('GET /api/recommendations/skills returns 200 with suggestedSkills array', async () => {
    const res = await request('GET', '/api/recommendations/skills', null, suggToken);
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.data.suggestedSkills), 'suggestedSkills must be array');
  });

  await test('Skill suggestions exclude skills already offered or wanted by the user', async () => {
    const res = await request('GET', '/api/recommendations/skills', null, suggToken);
    const suggested = res.data.suggestedSkills.map(s => s.skill.toLowerCase());
    assert.ok(!suggested.includes('javascript'), 'Should not suggest JavaScript — already offered');
    assert.ok(!suggested.includes('react'),      'Should not suggest React — already wanted');
  });

  // ── GROUP 12: Dashboard endpoint (2 tests) ──────────────────────────────────
  console.log('\n── Group 12: Dashboard Endpoint ──');

  const dashUser = await createUser({
    name: 'Dashboard Seeker',
    skillsWanted: [{ skill: 'React', category: 'Programming', priority: 'High' }],
  });
  createdUserIds.push(dashUser._id);
  const dashToken = makeToken(dashUser._id);

  await test('GET /api/recommendations/dashboard returns 200', async () => {
    const res = await request('GET', '/api/recommendations/dashboard', null, dashToken);
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.data.recommendations));
  });

  await test('Dashboard endpoint returns at most 3 recommendations', async () => {
    const res = await request('GET', '/api/recommendations/dashboard', null, dashToken);
    assert.ok(res.data.recommendations.length <= 3,
      `Dashboard must return ≤ 3, got ${res.data.recommendations.length}`);
  });

  // ── GROUP 13: Self-exclusion (1 test) ───────────────────────────────────────
  console.log('\n── Group 13: Self-Exclusion ──');

  await test('Current user never appears in their own recommendations', async () => {
    const selfUser = await createUser({
      name: 'Self Test User',
      skillsOffered: [{ skill: 'React', category: 'Programming', level: 'Advanced' }],
      skillsWanted:  [{ skill: 'Python', category: 'Programming', priority: 'High' }],
    });
    createdUserIds.push(selfUser._id);
    const selfToken = makeToken(selfUser._id);
    const res = await request('GET', '/api/recommendations/partners', null, selfToken);
    const ids = res.data.recommendations.map(r => r.user._id.toString());
    assert.ok(!ids.includes(selfUser._id.toString()), 'Self must never be in recommendations');
  });

  // ── GROUP 14: Data privacy (3 tests) ────────────────────────────────────────
  console.log('\n── Group 14: Data Privacy ──');

  await test('Recommendations never expose password field', async () => {
    const privacyUser = await createUser({
      name: 'Privacy Seeker',
      skillsWanted: [{ skill: 'React', category: 'Programming', priority: 'High' }],
    });
    createdUserIds.push(privacyUser._id);
    const token = makeToken(privacyUser._id);
    const res = await request('GET', '/api/recommendations/partners', null, token);
    for (const rec of res.data.recommendations) {
      assert.ok(!rec.user.password, 'password must not be exposed');
      assert.ok(!rec.user.blockedUsers, 'blockedUsers must not be exposed');
    }
  });

  await test('Admin users do not appear in recommendations', async () => {
    const adminUser = await createUser({
      name:  'Hidden Admin',
      email: EMAIL('admin'),
      role:  'admin',
      skillsOffered: [{ skill: 'React', category: 'Programming', level: 'Advanced' }],
    });
    createdUserIds.push(adminUser._id);
    const reqUser = await createUser({
      name: 'Admin Privacy Seeker',
      skillsWanted: [{ skill: 'React', category: 'Programming', priority: 'High' }],
    });
    createdUserIds.push(reqUser._id);
    const token = makeToken(reqUser._id);
    const res = await request('GET', '/api/recommendations/partners', null, token);
    const names = res.data.recommendations.map(r => r.user.name);
    assert.ok(!names.includes('Hidden Admin'), 'Admin users must never appear in recommendations');
  });

  await test('Skill suggestions never expose password or private fields', async () => {
    const res = await request('GET', '/api/recommendations/skills', null, suggToken);
    // suggestedSkills contains only: skill, category, potentialPartners, reason
    for (const s of res.data.suggestedSkills) {
      assert.ok(!s.password,     'No password in suggestions');
      assert.ok(!s.email,        'No email in suggestions');
      assert.ok(s.skill,         'Must have skill name');
      assert.ok(s.reason,        'Must have reason string');
      assert.ok(typeof s.potentialPartners === 'number', 'potentialPartners must be a number');
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // CLEANUP
  // ─────────────────────────────────────────────────────────────────────────────
  try {
    await User.deleteMany({ _id: { $in: createdUserIds } });
    await SwapRequest.deleteMany({ _id: { $in: createdSwapIds } });
    await SkillVerification.deleteMany({ _id: { $in: createdVerifIds } });
    await Endorsement.deleteMany({ _id: { $in: createdEndorseIds } });
  } catch (err) {
    console.warn('[Cleanup] Error during cleanup:', err.message);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // RESULTS
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  if (failures.length > 0) {
    console.log('\n  Failures:');
    failures.forEach(f => console.log(`    ✗ ${f.name}\n      → ${f.error}`));
  }
  console.log('═══════════════════════════════════════════════════\n');

  server.close(() => {
    mongoose.connection.close();
    process.exit(failed > 0 ? 1 : 0);
  });
})();
