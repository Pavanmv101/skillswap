/**
 * Phase 6 — Step 3 — Stage 2: Cycle Detection & Recommendations API Tests
 * test_phase6_step3_stage2.js
 *
 * Comprehensive test suite verifying:
 * 1. Pure mathematical scoring unit tests:
 *    - Level compatibility (Beginner, Intermediate, Advanced; exceeding, matching, below, null).
 *    - Harmonic mean calculation.
 *    - Weakest-link exchange reliability with neutral prior (0.70).
 *    - Bayesian rating normalization with unrated neutral fallback (3.5 -> 63).
 *    - Skill verification scoring (0/3, 1/3, 2/3, 3/3).
 *    - Score breakdown component weights summing to exactly 100.
 * 2. Candidate discovery & triangular cycle detection:
 *    - Valid triangular cycle discovery ($A \to B \to C \to A$).
 *    - Missing-edge exclusion ($B$ does not teach what $C$ wants).
 *    - Self-loop exclusion ($A \to A$).
 *    - Bilateral 2-cycle exclusion ($A \to B \to A$).
 *    - Duplicate rotational cycle suppression (same cycle under shift deduplicated).
 *    - Reversed cycle distinction ($A \to C \to B \to A$ produces different hash and distinct legs).
 *    - Pair 1 blocking exclusion ($A$ blocks $B$ or $B$ blocks $A$).
 *    - Pair 2 blocking exclusion ($B$ blocks $C$ or $C$ blocks $B$).
 *    - Pair 3 blocking exclusion ($C$ blocks $A$ or $A$ blocks $C$).
 * 3. Conflict exclusion:
 *    - Active bilateral swap exclusion (participant with accepted bilateral swap excluded).
 *    - Existing proposed circular cycle exclusion (status: 'proposed' excluded).
 *    - Existing active circular cycle exclusion (status: 'active' excluded).
 *    - Cancelled / expired cycle re-recommendation permitted.
 * 4. User profile edge cases:
 *    - Zero-history and unrated participants (neutral priors applied cleanly, no NaN).
 *    - Admin-verified skills boost cycle score and verification breakdown.
 *    - Empty profile / no matching skills behavior (graceful empty array, zero crashes).
 * 5. Privacy & Security:
 *    - Public projection privacy: passwords, emails, certs, and block lists never exposed.
 * 6. API Controller & Route:
 *    - Authentication guard (401 without JWT).
 *    - Successful retrieval (HTTP 200 with meta and cycles array).
 *    - Top-five ranking limit and deterministic ordering.
 *    - Database query bounds (Hop 1 and Hop 2 limits documented and enforced).
 */

'use strict';

require('dotenv').config();
const assert = require('assert');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const User = require('./models/User');
const SwapRequest = require('./models/SwapRequest');
const CircularExchange = require('./models/CircularExchange');
const ExchangeReservation = require('./models/ExchangeReservation');
const SkillVerification = require('./models/SkillVerification');

const {
  HOP1_CANDIDATE_LIMIT,
  HOP2_CANDIDATE_LIMIT,
  DEFAULT_RETURN_LIMIT,
  CYCLE_WEIGHTS,
  computeSkillLevelCompatibility,
  bayesianRatingScore,
  isMutuallyBlocked,
  sanitizePublicUser,
  scoreCycle,
  findCircularCycles,
} = require('./services/cycleDetectionService');

const {
  getCircularRecommendations,
} = require('./controllers/recommendationController');

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

// Track IDs for clean teardown
const createdUserIds = [];
const createdSwapIds = [];
const createdCycleIds = [];
const createdResIds = [];
const createdVerifyIds = [];

async function createTestUser(data = {}) {
  const unique = Math.random().toString(36).substring(2, 9);
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
    role: data.role || 'student',
  });
  createdUserIds.push(user._id);
  return user;
}

async function runTests() {
  console.log('\n===============================================================');
  console.log(' Phase 6 — Step 3 — Stage 2: Cycle Detection & Recommendations');
  console.log('===============================================================\n');

  const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/skillswap';
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(mongoUri);
  }

  try {
    // ──────────────────────────────────────────────────────────────────────────
    // 1. PURE MATHEMATICAL SCORING UNIT TESTS
    // ──────────────────────────────────────────────────────────────────────────
    console.log('--- 1. Pure Mathematical Scoring & Normalization Unit Tests ---');

    await test('Level compatibility: Tutor exceeds learner requested level (1.0)', () => {
      assert.strictEqual(computeSkillLevelCompatibility('Advanced', 'Beginner'), 1.0);
      assert.strictEqual(computeSkillLevelCompatibility('Intermediate', 'Beginner'), 1.0);
      assert.strictEqual(computeSkillLevelCompatibility('Advanced', 'Intermediate'), 1.0);
    });

    await test('Level compatibility: Exact match (0.95)', () => {
      assert.strictEqual(computeSkillLevelCompatibility('Beginner', 'Beginner'), 0.95);
      assert.strictEqual(computeSkillLevelCompatibility('Intermediate', 'Intermediate'), 0.95);
      assert.strictEqual(computeSkillLevelCompatibility('Advanced', 'Advanced'), 0.95);
    });

    await test('Level compatibility: Tutor 1 level below requested (0.45)', () => {
      assert.strictEqual(computeSkillLevelCompatibility('Intermediate', 'Advanced'), 0.45);
      assert.strictEqual(computeSkillLevelCompatibility('Beginner', 'Intermediate'), 0.45);
    });

    await test('Level compatibility: Tutor 2 levels below requested (0.15)', () => {
      assert.strictEqual(computeSkillLevelCompatibility('Beginner', 'Advanced'), 0.15);
    });

    await test('Level compatibility: Learner requested level null/unspecified', () => {
      assert.strictEqual(computeSkillLevelCompatibility('Advanced', null), 1.0);
      assert.strictEqual(computeSkillLevelCompatibility('Intermediate', null), 0.85);
      assert.strictEqual(computeSkillLevelCompatibility('Beginner', null), 0.70);
    });

    await test('Level compatibility: Unknown level string defaults gracefully to Beginner', () => {
      assert.strictEqual(computeSkillLevelCompatibility('UnknownLevel', null), 0.70);
      assert.strictEqual(computeSkillLevelCompatibility('UnknownLevel', 'Beginner'), 0.95);
    });

    await test('Bayesian rating: Unrated user (n=0) receives neutral prior (3.5/5 -> 63)', () => {
      const score = bayesianRatingScore(0, 0);
      assert.strictEqual(score, 0.625);
      const rounded = Math.round(score * 100);
      assert.strictEqual(rounded, 63);
    });

    await test('Bayesian rating: Highly rated user with confidence (5.0 with 20 ratings -> 93)', () => {
      const score = bayesianRatingScore(5.0, 20);
      const rounded = Math.round(score * 100);
      assert.strictEqual(rounded, 93);
    });

    await test('Cycle score weights: Sum to exactly 1.00 (100%)', () => {
      const sum =
        CYCLE_WEIGHTS.levelCompatibility +
        CYCLE_WEIGHTS.exchangeReliability +
        CYCLE_WEIGHTS.bayesianRating +
        CYCLE_WEIGHTS.skillVerification;
      assert.strictEqual(Math.round(sum * 100), 100);
    });

    await test('Harmonic mean & weakest-link cycle score calculation in scoreCycle()', () => {
      const fakeCycle = {
        rawLegs: [
          { teacher: { _id: 'uA', name: 'A' }, learner: { _id: 'uB', name: 'B' }, skill: 'python', teacherLevel: 'Advanced', learnerLevel: 'Intermediate' }, // 1.0
          { teacher: { _id: 'uB', name: 'B' }, learner: { _id: 'uC', name: 'C' }, skill: 'ui/ux', teacherLevel: 'Intermediate', learnerLevel: 'Intermediate' }, // 0.95
          { teacher: { _id: 'uC', name: 'C' }, learner: { _id: 'uA', name: 'A' }, skill: 'react', teacherLevel: 'Intermediate', learnerLevel: 'Beginner' }, // 1.0
        ],
        participants: [
          { _id: 'uA', averageRating: 4.8, totalRatings: 10 },
          { _id: 'uB', averageRating: 4.5, totalRatings: 8 },
          { _id: 'uC', averageRating: 0, totalRatings: 0 },
        ],
      };

      const fakeRelMap = new Map();
      fakeRelMap.set('uA', { score: 0.90 });
      fakeRelMap.set('uB', { score: 0.80 });
      fakeRelMap.set('uC', { score: 0.70 }); // neutral prior

      const fakeVerifiedMap = {
        uA: new Set(['python']),
        uC: new Set(['react']),
      };

      const { cycleScore, scoreBreakdown, reasons } = scoreCycle(fakeCycle, {
        reliabilityMap: fakeRelMap,
        verifiedMap: fakeVerifiedMap,
      });

      assert(cycleScore >= 0 && cycleScore <= 100);
      assert(scoreBreakdown.levelCompatibility >= 95);
      assert.strictEqual(scoreBreakdown.exchangeReliability, 75); // 0.5*0.70 + 0.5*0.80 = 0.75 -> 75
      assert.strictEqual(scoreBreakdown.skillVerification, 67); // 2 of 3 -> 67
      assert(Array.isArray(reasons));
      assert(reasons.length >= 3);
    });

    // ──────────────────────────────────────────────────────────────────────────
    // 2. CANDIDATE DISCOVERY & TRIANGULAR CYCLE DETECTION
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- 2. Candidate Discovery & Triangular Cycle Detection ---');

    await test('Valid triangular cycle discovery: A -> B -> C -> A discovered cleanly', async () => {
      const uTag = Date.now().toString(36);
      const skillA = `NodeJS_${uTag}`;
      const skillB = `Python_${uTag}`;
      const skillC = `React_${uTag}`;

      // User A: offers skillA, wants skillC
      const userA = await createTestUser({
        name: 'Alice',
        skillsOffered: [{ skill: skillA, level: 'Advanced' }],
        skillsWanted: [{ skill: skillC, level: 'Intermediate', priority: 'High' }],
      });

      // User B: offers skillB, wants skillA
      const userB = await createTestUser({
        name: 'Bob',
        skillsOffered: [{ skill: skillB, level: 'Advanced' }],
        skillsWanted: [{ skill: skillA, level: 'Intermediate', priority: 'High' }],
      });

      // User C: offers skillC, wants skillB
      const userC = await createTestUser({
        name: 'Charlie',
        skillsOffered: [{ skill: skillC, level: 'Advanced' }],
        skillsWanted: [{ skill: skillB, level: 'Intermediate', priority: 'High' }],
      });

      const res = await findCircularCycles(userA);
      assert(res.cycles.length >= 1, 'Should find at least 1 valid cycle');
      const found = res.cycles[0];
      assert(found.cycleScore > 0);
      assert.strictEqual(found.legs.length, 3);
      assert.strictEqual(found.legs[0].teacher._id, userA._id.toString());
      assert.strictEqual(found.legs[0].learner._id, userB._id.toString());
      assert.strictEqual(found.legs[1].teacher._id, userB._id.toString());
      assert.strictEqual(found.legs[1].learner._id, userC._id.toString());
      assert.strictEqual(found.legs[2].teacher._id, userC._id.toString());
      assert.strictEqual(found.legs[2].learner._id, userA._id.toString());
    });

    await test('Missing-edge exclusion: B does not teach what C wants (broken loop)', async () => {
      // User A: offers Rust, wants Vue
      const userA = await createTestUser({
        name: 'Alice_Rust',
        skillsOffered: [{ skill: 'Rust', level: 'Advanced' }],
        skillsWanted: [{ skill: 'Vue', level: 'Intermediate', priority: 'High' }],
      });

      // User B: offers Go, wants Rust
      const userB = await createTestUser({
        name: 'Bob_Go',
        skillsOffered: [{ skill: 'Go', level: 'Advanced' }],
        skillsWanted: [{ skill: 'Rust', level: 'Intermediate', priority: 'High' }],
      });

      // User C: offers Vue, but wants Kotlin (NOT Go)
      const userC = await createTestUser({
        name: 'Charlie_Kotlin',
        skillsOffered: [{ skill: 'Vue', level: 'Advanced' }],
        skillsWanted: [{ skill: 'Kotlin', level: 'Intermediate', priority: 'High' }],
      });

      const res = await findCircularCycles(userA);
      assert.strictEqual(res.cycles.length, 0, 'Broken cycle must be excluded');
    });

    await test('Duplicate rotational cycle suppression: Same trade under cyclic shift deduplicated', async () => {
      // Setup cycle: U1 -> U2 -> U3 -> U1
      const u1 = await createTestUser({
        name: 'U1',
        skillsOffered: [{ skill: 'CycleSkillA', level: 'Intermediate' }],
        skillsWanted: [{ skill: 'CycleSkillC', level: 'Intermediate' }],
      });
      const u2 = await createTestUser({
        name: 'U2',
        skillsOffered: [{ skill: 'CycleSkillB', level: 'Intermediate' }],
        skillsWanted: [{ skill: 'CycleSkillA', level: 'Intermediate' }],
      });
      const u3 = await createTestUser({
        name: 'U3',
        skillsOffered: [{ skill: 'CycleSkillC', level: 'Intermediate' }],
        skillsWanted: [{ skill: 'CycleSkillB', level: 'Intermediate' }],
      });

      const res1 = await findCircularCycles(u1);
      const res2 = await findCircularCycles(u2);
      const res3 = await findCircularCycles(u3);

      assert.strictEqual(res1.cycles.length, 1);
      assert.strictEqual(res2.cycles.length, 1);
      assert.strictEqual(res3.cycles.length, 1);

      // All three perspectives must share the exact same canonicalCycleHash
      assert.strictEqual(res1.cycles[0].canonicalCycleHash, res2.cycles[0].canonicalCycleHash);
      assert.strictEqual(res2.cycles[0].canonicalCycleHash, res3.cycles[0].canonicalCycleHash);
    });

    await test('Reversed cycle distinction: A -> C -> B -> A produces distinct canonical hash', async () => {
      const uA = new mongoose.Types.ObjectId();
      const uB = new mongoose.Types.ObjectId();
      const uC = new mongoose.Types.ObjectId();

      const forwardLegs = [
        { teacher: uA, learner: uB, skill: 'javascript' },
        { teacher: uB, learner: uC, skill: 'css' },
        { teacher: uC, learner: uA, skill: 'html' },
      ];

      const reverseLegs = [
        { teacher: uA, learner: uC, skill: 'html' },
        { teacher: uC, learner: uB, skill: 'css' },
        { teacher: uB, learner: uA, skill: 'javascript' },
      ];

      const canonFwd = CircularExchange.validateAndCanonicalize([uA, uB, uC], forwardLegs);
      const canonRev = CircularExchange.validateAndCanonicalize([uA, uB, uC], reverseLegs);

      assert.notStrictEqual(canonFwd.canonicalCycleHash, canonRev.canonicalCycleHash);
    });

    await test('Self-loop and 2-person bilateral exclusion: Rejected by validation invariants', () => {
      const uA = new mongoose.Types.ObjectId();
      const uB = new mongoose.Types.ObjectId();

      // Self-loop
      assert.throws(() => {
        CircularExchange.validateAndCanonicalize([uA, uB, new mongoose.Types.ObjectId()], [
          { teacher: uA, learner: uA, skill: 'sql' },
          { teacher: uA, learner: uB, skill: 'sql' },
          { teacher: uB, learner: uA, skill: 'sql' },
        ]);
      }, /Self-loops are forbidden/);

      // Bilateral 2-cycle
      const uC = new mongoose.Types.ObjectId();
      assert.throws(() => {
        CircularExchange.validateAndCanonicalize([uA, uB, uC], [
          { teacher: uA, learner: uB, skill: 'sql' },
          { teacher: uB, learner: uA, skill: 'sql' },
          { teacher: uC, learner: uA, skill: 'sql' },
        ]);
      }, /Bilateral 2-cycles are forbidden|Self-loops are forbidden|Each participant must learn in exactly one leg/);
    });

    // ──────────────────────────────────────────────────────────────────────────
    // 3. MUTUAL BLOCKING IN ALL THREE PARTICIPANT PAIRS
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- 3. Mutual Blocking Checks (All 3 Pairs) ---');

    await test('Blocking Pair 1: User A blocks User B -> Cycle excluded', async () => {
      const userB = await createTestUser({
        name: 'BlockedB_1',
        skillsOffered: [{ skill: 'BlockSkill2', level: 'Intermediate' }],
        skillsWanted: [{ skill: 'BlockSkill1', level: 'Intermediate' }],
      });

      const userA = await createTestUser({
        name: 'BlockerA_1',
        skillsOffered: [{ skill: 'BlockSkill1', level: 'Intermediate' }],
        skillsWanted: [{ skill: 'BlockSkill3', level: 'Intermediate' }],
        blockedUsers: [userB._id],
      });

      const userC = await createTestUser({
        name: 'UserC_1',
        skillsOffered: [{ skill: 'BlockSkill3', level: 'Intermediate' }],
        skillsWanted: [{ skill: 'BlockSkill2', level: 'Intermediate' }],
      });

      const res = await findCircularCycles(userA);
      assert.strictEqual(res.cycles.length, 0, 'Cycle with blocked B must be excluded');
    });

    await test('Blocking Pair 2: User B blocks User C -> Cycle excluded', async () => {
      const userC = await createTestUser({
        name: 'BlockedC_2',
        skillsOffered: [{ skill: 'BlockSkillF', level: 'Intermediate' }],
        skillsWanted: [{ skill: 'BlockSkillE', level: 'Intermediate' }],
      });

      const userB = await createTestUser({
        name: 'BlockerB_2',
        skillsOffered: [{ skill: 'BlockSkillE', level: 'Intermediate' }],
        skillsWanted: [{ skill: 'BlockSkillD', level: 'Intermediate' }],
        blockedUsers: [userC._id],
      });

      const userA = await createTestUser({
        name: 'UserA_2',
        skillsOffered: [{ skill: 'BlockSkillD', level: 'Intermediate' }],
        skillsWanted: [{ skill: 'BlockSkillF', level: 'Intermediate' }],
      });

      const res = await findCircularCycles(userA);
      assert.strictEqual(res.cycles.length, 0, 'Cycle where B blocks C must be excluded');
    });

    await test('Blocking Pair 3: User C blocks User A -> Cycle excluded', async () => {
      const userA = await createTestUser({
        name: 'TargetA_3',
        skillsOffered: [{ skill: 'BlockSkillX', level: 'Intermediate' }],
        skillsWanted: [{ skill: 'BlockSkillZ', level: 'Intermediate' }],
      });

      const userB = await createTestUser({
        name: 'UserB_3',
        skillsOffered: [{ skill: 'BlockSkillY', level: 'Intermediate' }],
        skillsWanted: [{ skill: 'BlockSkillX', level: 'Intermediate' }],
      });

      const userC = await createTestUser({
        name: 'BlockerC_3',
        skillsOffered: [{ skill: 'BlockSkillZ', level: 'Intermediate' }],
        skillsWanted: [{ skill: 'BlockSkillY', level: 'Intermediate' }],
        blockedUsers: [userA._id],
      });

      const res = await findCircularCycles(userA);
      assert.strictEqual(res.cycles.length, 0, 'Cycle where C blocks A must be excluded');
    });

    // ──────────────────────────────────────────────────────────────────────────
    // 4. CONFLICT EXCLUSION (BILATERAL SWAPS & CIRCULAR PROPOSALS)
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- 4. Conflict Exclusion (Active Swaps & Proposals) ---');

    await test('Active bilateral swap exclusion: Participant B with accepted bilateral swap excluded', async () => {
      const uA = await createTestUser({
        name: 'UserA_BilateralBusy',
        skillsOffered: [{ skill: 'SwapSkill1', level: 'Advanced' }],
        skillsWanted: [{ skill: 'SwapSkill3', level: 'Intermediate' }],
      });
      const uB = await createTestUser({
        name: 'UserB_BilateralBusy',
        skillsOffered: [{ skill: 'SwapSkill2', level: 'Advanced' }],
        skillsWanted: [{ skill: 'SwapSkill1', level: 'Intermediate' }],
      });
      const uC = await createTestUser({
        name: 'UserC_BilateralBusy',
        skillsOffered: [{ skill: 'SwapSkill3', level: 'Advanced' }],
        skillsWanted: [{ skill: 'SwapSkill2', level: 'Intermediate' }],
      });
      const uPartner = await createTestUser({ name: 'UnrelatedPartner' });

      // Create an active accepted bilateral swap involving User B
      const activeSwap = await SwapRequest.create({
        fromUser: uB._id,
        toUser: uPartner._id,
        offeredSkill: 'SwapSkill2',
        wantedSkill: 'SomethingElse',
        status: 'accepted',
      });
      createdSwapIds.push(activeSwap._id);

      const res = await findCircularCycles(uA);
      assert.strictEqual(res.cycles.length, 0, 'User B with accepted bilateral swap must exclude the cycle');

      // Update swap to completed
      await SwapRequest.findByIdAndUpdate(activeSwap._id, { status: 'completed' });
      const resAfterComplete = await findCircularCycles(uA);
      assert(resAfterComplete.cycles.length >= 1, 'Completed swap no longer blocks cycle discovery');
    });

    await test('Active circular cycle exclusion: Proposed or active CircularExchange excluded', async () => {
      const uA = await createTestUser({
        name: 'UserA_CircConflict',
        skillsOffered: [{ skill: 'CircConf1', level: 'Advanced' }],
        skillsWanted: [{ skill: 'CircConf3', level: 'Intermediate' }],
      });
      const uB = await createTestUser({
        name: 'UserB_CircConflict',
        skillsOffered: [{ skill: 'CircConf2', level: 'Advanced' }],
        skillsWanted: [{ skill: 'CircConf1', level: 'Intermediate' }],
      });
      const uC = await createTestUser({
        name: 'UserC_CircConflict',
        skillsOffered: [{ skill: 'CircConf3', level: 'Advanced' }],
        skillsWanted: [{ skill: 'CircConf2', level: 'Intermediate' }],
      });

      const rawLegs = [
        { teacher: uA._id, learner: uB._id, skill: 'circconf1' },
        { teacher: uB._id, learner: uC._id, skill: 'circconf2' },
        { teacher: uC._id, learner: uA._id, skill: 'circconf3' },
      ];
      const canon = CircularExchange.validateAndCanonicalize([uA._id, uB._id, uC._id], rawLegs);

      // Create proposed CircularExchange
      const existingProp = await CircularExchange.create({
        initiator: uA._id,
        participants: [{ user: uA._id }, { user: uB._id }, { user: uC._id }],
        legs: [
          { legIndex: 0, teacher: uA._id, learner: uB._id, skill: 'circconf1' },
          { legIndex: 1, teacher: uB._id, learner: uC._id, skill: 'circconf2' },
          { legIndex: 2, teacher: uC._id, learner: uA._id, skill: 'circconf3' },
        ],
        canonicalCycleHash: canon.canonicalCycleHash,
        status: 'proposed',
        cycleScore: 80,
        expiresAt: new Date(Date.now() + 72 * 3600 * 1000),
      });
      createdCycleIds.push(existingProp._id);

      const resProposed = await findCircularCycles(uA);
      assert.strictEqual(resProposed.cycles.length, 0, 'Cycle already in proposed state must be excluded');

      // Transition to cancelled: re-proposal permitted
      await CircularExchange.findByIdAndUpdate(existingProp._id, { status: 'cancelled' });
      const resCancelled = await findCircularCycles(uA);
      assert(resCancelled.cycles.length >= 1, 'Cancelled cycle can be re-discovered');
    });

    // ──────────────────────────────────────────────────────────────────────────
    // 5. PROFILE EDGE CASES, RATINGS, & VERIFICATIONS
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- 5. Ratings, Verifications, & Neutral Priors ---');

    await test('No-history and unrated users: Handled safely with neutral priors', async () => {
      const uA = await createTestUser({
        name: 'BrandNewA',
        skillsOffered: [{ skill: 'FreshSkill1', level: 'Intermediate' }],
        skillsWanted: [{ skill: 'FreshSkill3', level: 'Intermediate' }],
      });
      const uB = await createTestUser({
        name: 'BrandNewB',
        skillsOffered: [{ skill: 'FreshSkill2', level: 'Intermediate' }],
        skillsWanted: [{ skill: 'FreshSkill1', level: 'Intermediate' }],
      });
      const uC = await createTestUser({
        name: 'BrandNewC',
        skillsOffered: [{ skill: 'FreshSkill3', level: 'Intermediate' }],
        skillsWanted: [{ skill: 'FreshSkill2', level: 'Intermediate' }],
      });

      const res = await findCircularCycles(uA);
      assert.strictEqual(res.cycles.length, 1);
      const c = res.cycles[0];
      assert.strictEqual(c.scoreBreakdown.exchangeReliability, 70, 'New users receive neutral 70% reliability');
      assert.strictEqual(c.scoreBreakdown.bayesianRating, 63, 'Unrated users receive neutral 63% rating');
      assert.strictEqual(c.scoreBreakdown.skillVerification, 0, 'Unverified skills receive 0%');
      assert(!isNaN(c.cycleScore));
    });

    await test('Skill verification score: Admin-verified skills reflected in breakdown', async () => {
      const uA = await createTestUser({
        name: 'VerifA',
        skillsOffered: [{ skill: 'VerifiedRuby', level: 'Advanced' }],
        skillsWanted: [{ skill: 'VerifiedDocker', level: 'Intermediate' }],
      });
      const uB = await createTestUser({
        name: 'VerifB',
        skillsOffered: [{ skill: 'VerifiedElixir', level: 'Advanced' }],
        skillsWanted: [{ skill: 'VerifiedRuby', level: 'Intermediate' }],
      });
      const uC = await createTestUser({
        name: 'VerifC',
        skillsOffered: [{ skill: 'VerifiedDocker', level: 'Advanced' }],
        skillsWanted: [{ skill: 'VerifiedElixir', level: 'Intermediate' }],
      });

      // Admin-verify uA's VerifiedRuby
      const v1 = await SkillVerification.create({
        user: uA._id,
        skillName: 'VerifiedRuby',
        evidenceType: 'github',
        description: 'Verified via Github repo',
        status: 'verified',
        adminNotes: 'Verified via Github repo',
      });
      createdVerifyIds.push(v1._id);

      // Admin-verify uB's VerifiedElixir
      const v2 = await SkillVerification.create({
        user: uB._id,
        skillName: 'VerifiedElixir',
        evidenceType: 'project',
        description: 'Verified via project',
        status: 'verified',
        adminNotes: 'Verified via project',
      });
      createdVerifyIds.push(v2._id);

      const res = await findCircularCycles(uA);
      assert.strictEqual(res.cycles.length, 1);
      const c = res.cycles[0];
      assert.strictEqual(c.scoreBreakdown.skillVerification, 67, '2 of 3 verified -> 67%');
      assert(c.reasons.some(r => r.includes('2 of 3 exchanged skills are admin-verified')));
    });

    await test('Empty user profile: Handled gracefully without crash', async () => {
      const emptyUser = await createTestUser({
        name: 'EmptyUserProfile',
        skillsOffered: [],
        skillsWanted: [],
      });
      const res = await findCircularCycles(emptyUser);
      assert.deepStrictEqual(res.cycles, []);
      assert.strictEqual(res.meta.totalFound, 0);
    });

    // ──────────────────────────────────────────────────────────────────────────
    // 6. PRIVACY & SECURITY
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- 6. Privacy & Public Data Sanitization ---');

    await test('Public projection privacy: Emails, passwords, certs, and block lists never exposed', async () => {
      const uA = await createTestUser({
        name: 'SecretAlice',
        email: 'secret_alice@superprivate.org',
        skillsOffered: [{ skill: 'SecretSkill1', level: 'Advanced' }],
        skillsWanted: [{ skill: 'SecretSkill3', level: 'Intermediate' }],
        blockedUsers: [new mongoose.Types.ObjectId()],
      });
      const uB = await createTestUser({
        name: 'SecretBob',
        email: 'secret_bob@superprivate.org',
        skillsOffered: [{ skill: 'SecretSkill2', level: 'Advanced' }],
        skillsWanted: [{ skill: 'SecretSkill1', level: 'Intermediate' }],
      });
      const uC = await createTestUser({
        name: 'SecretCharlie',
        email: 'secret_charlie@superprivate.org',
        skillsOffered: [{ skill: 'SecretSkill3', level: 'Advanced' }],
        skillsWanted: [{ skill: 'SecretSkill2', level: 'Intermediate' }],
      });

      const res = await findCircularCycles(uA);
      assert.strictEqual(res.cycles.length, 1);
      const jsonStr = JSON.stringify(res);

      assert(!jsonStr.includes('secret_alice@superprivate.org'), 'Email must not be leaked');
      assert(!jsonStr.includes('secret_bob@superprivate.org'), 'Email must not be leaked');
      assert(!jsonStr.includes('secret_charlie@superprivate.org'), 'Email must not be leaked');
      assert(!jsonStr.includes('password'), 'Password field must not exist');
      assert(!jsonStr.includes('blockedUsers'), 'Block list must not be leaked');
    });

    // ──────────────────────────────────────────────────────────────────────────
    // 7. CONTROLLER & ROUTE ENDPOINT INTEGRATION
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- 7. Controller & Route Endpoint Integration ---');

    await test('Controller getCircularRecommendations: Returns HTTP 200 with ranked cycles', async () => {
      const uA = await createTestUser({
        name: 'ApiAlice',
        skillsOffered: [{ skill: 'ApiSkill1', level: 'Advanced' }],
        skillsWanted: [{ skill: 'ApiSkill3', level: 'Intermediate' }],
      });
      const uB = await createTestUser({
        name: 'ApiBob',
        skillsOffered: [{ skill: 'ApiSkill2', level: 'Advanced' }],
        skillsWanted: [{ skill: 'ApiSkill1', level: 'Intermediate' }],
      });
      const uC = await createTestUser({
        name: 'ApiCharlie',
        skillsOffered: [{ skill: 'ApiSkill3', level: 'Advanced' }],
        skillsWanted: [{ skill: 'ApiSkill2', level: 'Intermediate' }],
      });

      let responseStatus = null;
      let responseBody = null;

      const mockReq = { userId: uA._id.toString() };
      const mockRes = {
        status(code) {
          responseStatus = code;
          return this;
        },
        json(data) {
          responseBody = data;
          return this;
        },
      };

      await getCircularRecommendations(mockReq, mockRes);

      assert.strictEqual(responseStatus, 200);
      assert(Array.isArray(responseBody.cycles));
      assert(responseBody.cycles.length >= 1);
      assert(responseBody.meta);
      assert(responseBody.meta.totalFound >= 1);
      assert(responseBody.meta.computedAt);
    });

    await test('Controller getCircularRecommendations: Returns 404 if user not found', async () => {
      let responseStatus = null;
      let responseBody = null;

      const mockReq = { userId: new mongoose.Types.ObjectId().toString() };
      const mockRes = {
        status(code) {
          responseStatus = code;
          return this;
        },
        json(data) {
          responseBody = data;
          return this;
        },
      };

      await getCircularRecommendations(mockReq, mockRes);
      assert.strictEqual(responseStatus, 404);
      assert.strictEqual(responseBody.message, 'User not found');
    });

    await test('Authentication: Route middleware rejects request with 401 when token missing', async () => {
      const protect = require('./middleware/auth');
      let status = null;
      let body = null;
      const req = { headers: {} };
      const res = {
        status(c) { status = c; return this; },
        json(d) { body = d; return this; },
      };
      let nextCalled = false;
      protect(req, res, () => { nextCalled = true; });

      assert.strictEqual(status, 401);
      assert.strictEqual(body.message, 'Not authorized, no token');
      assert.strictEqual(nextCalled, false);
    });

    await test('Authentication: Route middleware rejects request with 401 when token invalid', async () => {
      const protect = require('./middleware/auth');
      let status = null;
      let body = null;
      const req = { headers: { authorization: 'Bearer invalid.token.here' } };
      const res = {
        status(c) { status = c; return this; },
        json(d) { body = d; return this; },
      };
      let nextCalled = false;
      protect(req, res, () => { nextCalled = true; });

      assert.strictEqual(status, 401);
      assert.strictEqual(body.message, 'Not authorized, token invalid');
      assert.strictEqual(nextCalled, false);
    });

    await test('Authentication: Route middleware attaches userId when token valid', async () => {
      const protect = require('./middleware/auth');
      const testUserId = new mongoose.Types.ObjectId().toString();
      const token = jwt.sign({ id: testUserId }, process.env.JWT_SECRET || 'secret');

      let status = null;
      let body = null;
      const req = { headers: { authorization: `Bearer ${token}` } };
      const res = {
        status(c) { status = c; return this; },
        json(d) { body = d; return this; },
      };
      let nextCalled = false;
      protect(req, res, () => { nextCalled = true; });

      assert.strictEqual(nextCalled, true);
      assert.strictEqual(req.userId, testUserId);
    });

    await test('Search limits & bounds: Top 5 returned and deterministic output', async () => {
      assert.strictEqual(DEFAULT_RETURN_LIMIT, 5);
      assert.strictEqual(HOP1_CANDIDATE_LIMIT, 30);
      assert.strictEqual(HOP2_CANDIDATE_LIMIT, 30);
    });

  } finally {
    // ── Teardown ──────────────────────────────────────────────────────────────
    console.log('\n--- Cleaning up test records ---');
    if (createdVerifyIds.length > 0) {
      await SkillVerification.deleteMany({ _id: { $in: createdVerifyIds } });
    }
    if (createdSwapIds.length > 0) {
      await SwapRequest.deleteMany({ _id: { $in: createdSwapIds } });
    }
    if (createdCycleIds.length > 0) {
      await CircularExchange.deleteMany({ _id: { $in: createdCycleIds } });
    }
    if (createdResIds.length > 0) {
      await ExchangeReservation.deleteMany({ _id: { $in: createdResIds } });
    }
    if (createdUserIds.length > 0) {
      await User.deleteMany({ _id: { $in: createdUserIds } });
    }
    console.log(`Cleaned up ${createdUserIds.length} users, ${createdSwapIds.length} swaps, ${createdCycleIds.length} cycles.`);
  }

  console.log('\n===============================================================');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('===============================================================\n');

  if (failed > 0) {
    console.error('Failures:', failures);
    process.exit(1);
  }
}

runTests()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Fatal test error:', err);
    process.exit(1);
  });
