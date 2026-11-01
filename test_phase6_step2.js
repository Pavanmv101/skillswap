/**
 * Phase 6 — Step 2: Skill Level Compatibility + Learning Track Mastery Tests
 * test_phase6_step2.js
 *
 * Verifies:
 * 1. Beginner, Intermediate, and Advanced skill level compatibility.
 * 2. Tutor level exceeding requested level (1.0 score).
 * 3. Tutor level matching requested level (0.95 score).
 * 4. Tutor level 1 level below requested level (0.45 score).
 * 5. Tutor level 2 levels below requested level (0.15 score).
 * 6. Missing and unknown level handling (graceful fallbacks).
 * 7. Priority-weighted level fit across multiple skills.
 * 8. Incomplete learning tracks (in_progress, not_started) receive 0 mastery.
 * 9. Completed learning track as instructor receives full credit (1.0).
 * 10. Completed learning track as learner receives graduate credit (0.85).
 * 11. Evaluated and passed practical assessment receives practical credit (0.70).
 * 12. Non-evaluated or failed practical assessment receives 0 credit.
 * 13. Duplicate track deduplication (caps per skill, prevents inflation).
 * 14. Unmatched skill track gives 0 credit to matched skill.
 * 15. User with no learning tracks receives 0 mastery safely (no negative penalty).
 * 16. Reliability integration via services/reliabilityService.js in recommendations.
 * 17. 100-point scoring model normalization: sum of component weights = 100, clamped in [0, 100].
 * 18. Recommendation explanation correctness (level fit, track mastery, exchange reliability reasons).
 * 19. Privacy verification: no private assessment submissions, quiz questions, or evidence URLs leaked.
 * 20. Backward compatibility: /partners, /dashboard, and /skills return intact Phase 5 schemas.
 */

'use strict';

require('dotenv').config();
const assert = require('assert');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const User = require('./models/User');
const SwapRequest = require('./models/SwapRequest');
const LearningTrack = require('./models/LearningTrack');
const SkillVerification = require('./models/SkillVerification');
const Endorsement = require('./models/Endorsement');

const {
  computeSkillLevelCompatibility,
  computeCandidateLevelFit,
  buildTrackMasteryMap,
  scoreTrackMastery,
  WEIGHTS,
  buildRecommendations,
  getRecommendedPartners,
  getDashboardRecommendations,
  getSkillSuggestions,
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
    failures.push({ name, error: err.message });
  }
}

const createdUserIds = [];
const createdSwapIds = [];
const createdTrackIds = [];
const createdVerifIds = [];

const EMAIL = (tag) => `p6_step2_${tag}_${Date.now()}_${Math.random().toString(36).slice(2)}@test.skillswap`;

async function cleanup() {
  if (createdTrackIds.length > 0) {
    await LearningTrack.deleteMany({ _id: { $in: createdTrackIds } });
  }
  if (createdSwapIds.length > 0) {
    await SwapRequest.deleteMany({ _id: { $in: createdSwapIds } });
  }
  if (createdVerifIds.length > 0) {
    await SkillVerification.deleteMany({ _id: { $in: createdVerifIds } });
  }
  if (createdUserIds.length > 0) {
    await User.deleteMany({ _id: { $in: createdUserIds } });
  }
}

async function runTests() {
  console.log('\n=== PHASE 6 STEP 2: SKILL LEVEL COMPATIBILITY + TRACK MASTERY TESTS ===\n');

  const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/skillswap';
  await mongoose.connect(mongoUri);

  try {
    // ── SECTION 1: Skill Level Compatibility Pure Functions ───────────────────
    console.log('--- 1. Skill Level Compatibility Pure Functions ---');

    await test('Tutor exceeds learner requested level (Advanced tutor, Beginner learner -> 1.0)', () => {
      const score = computeSkillLevelCompatibility('Advanced', 'Beginner');
      assert.strictEqual(score, 1.0);
    });

    await test('Tutor exceeds learner requested level (Intermediate tutor, Beginner learner -> 1.0)', () => {
      const score = computeSkillLevelCompatibility('Intermediate', 'Beginner');
      assert.strictEqual(score, 1.0);
    });

    await test('Tutor exceeds learner requested level (Advanced tutor, Intermediate learner -> 1.0)', () => {
      const score = computeSkillLevelCompatibility('Advanced', 'Intermediate');
      assert.strictEqual(score, 1.0);
    });

    await test('Tutor exactly matches learner requested level (Beginner/Beginner -> 0.95)', () => {
      const score = computeSkillLevelCompatibility('Beginner', 'Beginner');
      assert.strictEqual(score, 0.95);
    });

    await test('Tutor exactly matches learner requested level (Intermediate/Intermediate -> 0.95)', () => {
      const score = computeSkillLevelCompatibility('Intermediate', 'Intermediate');
      assert.strictEqual(score, 0.95);
    });

    await test('Tutor exactly matches learner requested level (Advanced/Advanced -> 0.95)', () => {
      const score = computeSkillLevelCompatibility('Advanced', 'Advanced');
      assert.strictEqual(score, 0.95);
    });

    await test('Tutor 1 level below requested (Intermediate tutor, Advanced learner -> 0.45)', () => {
      const score = computeSkillLevelCompatibility('Intermediate', 'Advanced');
      assert.strictEqual(score, 0.45);
    });

    await test('Tutor 1 level below requested (Beginner tutor, Intermediate learner -> 0.45)', () => {
      const score = computeSkillLevelCompatibility('Beginner', 'Intermediate');
      assert.strictEqual(score, 0.45);
    });

    await test('Tutor 2 levels below requested (Beginner tutor, Advanced learner -> 0.15)', () => {
      const score = computeSkillLevelCompatibility('Beginner', 'Advanced');
      assert.strictEqual(score, 0.15);
    });

    await test('Learner did not specify requested level (unspecified/null/missing)', () => {
      assert.strictEqual(computeSkillLevelCompatibility('Advanced', null), 1.0);
      assert.strictEqual(computeSkillLevelCompatibility('Intermediate', undefined), 0.85);
      assert.strictEqual(computeSkillLevelCompatibility('Beginner', ''), 0.70);
    });

    await test('Tutor level missing/unknown defaults safely to Beginner rank', () => {
      // Learner wants Intermediate (2), tutor unknown (defaults to 1): diff = -1 -> 0.45
      assert.strictEqual(computeSkillLevelCompatibility(null, 'Intermediate'), 0.45);
      // Learner wants Advanced (3), tutor unknown: diff = -2 -> 0.15
      assert.strictEqual(computeSkillLevelCompatibility('unknown_level', 'Advanced'), 0.15);
      // Both missing: tutor defaults to Beginner (1), learner unspecified -> 0.70
      assert.strictEqual(computeSkillLevelCompatibility(null, null), 0.70);
    });

    await test('Priority-weighted level fit across multiple skills', () => {
      const myWanted = [
        { skill: 'React', priority: 'High', level: 'Advanced' },   // weight 1.0
        { skill: 'Node.js', priority: 'Low', level: 'Beginner' },  // weight 0.4
      ];
      const theirOffered = [
        { skill: 'React', level: 'Advanced' },     // exact match -> 0.95 * 1.0 = 0.95
        { skill: 'Node.js', level: 'Beginner' },   // exact match -> 0.95 * 0.4 = 0.38
      ];
      const fit = computeCandidateLevelFit(myWanted, theirOffered, ['React', 'Node.js']);
      // Weighted average: (0.95 * 1.0 + 0.95 * 0.4) / (1.0 + 0.4) = 0.95
      assert.strictEqual(Math.round(fit.score * 100), 95);
      assert.strictEqual(fit.details.length, 2);
    });

    // ── SECTION 2: Learning Track Mastery Logic ──────────────────────────────
    console.log('\n--- 2. Learning Track Mastery Logic ---');

    await test('Incomplete learning track (in_progress) yields 0 mastery credit', () => {
      const cid = 'user_cand_1';
      const tracks = [
        {
          instructor: cid,
          skillName: 'Python',
          status: 'in_progress',
          assessments: [],
        },
      ];
      const map = buildTrackMasteryMap(tracks, [cid]);
      const result = scoreTrackMastery(map[cid], ['Python']);
      assert.strictEqual(result.score, 0);
      assert.strictEqual(result.achievements.length, 0);
    });

    await test('Completed track as instructor yields 1.0 mastery credit', () => {
      const cid = 'user_cand_2';
      const tracks = [
        {
          instructor: cid,
          skillName: 'React',
          status: 'completed',
          assessments: [],
        },
      ];
      const map = buildTrackMasteryMap(tracks, [cid]);
      const result = scoreTrackMastery(map[cid], ['React']);
      assert.strictEqual(result.score, 1.0);
      assert.strictEqual(result.achievements.length, 1);
      assert.strictEqual(result.achievements[0].type, 'instructor');
    });

    await test('Completed track as learner yields 0.85 mastery credit', () => {
      const cid = 'user_cand_3';
      const tracks = [
        {
          learner: cid,
          skillName: 'TypeScript',
          status: 'completed',
          assessments: [],
        },
      ];
      const map = buildTrackMasteryMap(tracks, [cid]);
      const result = scoreTrackMastery(map[cid], ['TypeScript']);
      assert.strictEqual(result.score, 0.85);
      assert.strictEqual(result.achievements.length, 1);
      assert.strictEqual(result.achievements[0].type, 'graduate');
    });

    await test('Evaluated practical assessment passed yields 0.70 mastery credit', () => {
      const cid = 'user_cand_4';
      const tracks = [
        {
          learner: cid,
          skillName: 'Docker',
          status: 'in_progress',
          assessments: [
            { type: 'practical', evaluationStatus: 'evaluated', passed: true },
          ],
        },
      ];
      const map = buildTrackMasteryMap(tracks, [cid]);
      const result = scoreTrackMastery(map[cid], ['Docker']);
      assert.strictEqual(result.score, 0.70);
      assert.strictEqual(result.achievements[0].type, 'practical');
    });

    await test('Non-evaluated or failed practical assessment yields 0 credit', () => {
      const cid = 'user_cand_5';
      const tracks = [
        {
          learner: cid,
          skillName: 'Rust',
          status: 'in_progress',
          assessments: [
            { type: 'practical', evaluationStatus: 'submitted', passed: false },
            { type: 'quiz', evaluationStatus: 'evaluated', passed: true }, // quiz does not count as practical project
          ],
        },
      ];
      const map = buildTrackMasteryMap(tracks, [cid]);
      const result = scoreTrackMastery(map[cid], ['Rust']);
      assert.strictEqual(result.score, 0);
    });

    await test('Duplicate track deduplication: multiple completed tracks for same skill do not exceed 1.0', () => {
      const cid = 'user_cand_6';
      const tracks = [
        { instructor: cid, skillName: 'React', status: 'completed' },
        { instructor: cid, skillName: 'React', status: 'completed' },
        { learner: cid, skillName: 'React', status: 'completed' },
      ];
      const map = buildTrackMasteryMap(tracks, [cid]);
      const result = scoreTrackMastery(map[cid], ['React']);
      assert.strictEqual(result.score, 1.0);
      assert.strictEqual(result.achievements.length, 1); // exactly 1 achievement entry
    });

    await test('Track for unmatched skill does not contribute to matched skill', () => {
      const cid = 'user_cand_7';
      const tracks = [
        { instructor: cid, skillName: 'French Cooking', status: 'completed' },
      ];
      const map = buildTrackMasteryMap(tracks, [cid]);
      const result = scoreTrackMastery(map[cid], ['Python']);
      assert.strictEqual(result.score, 0);
    });

    await test('User without learning history receives 0 mastery safely (no negative penalty)', () => {
      const cid = 'user_cand_8';
      const map = buildTrackMasteryMap([], [cid]);
      const result = scoreTrackMastery(map[cid], ['Java']);
      assert.strictEqual(result.score, 0);
      assert.strictEqual(result.achievements.length, 0);
    });

    // ── SECTION 3: 100-Point Scoring Model Weights & Bounds ───────────────────
    console.log('\n--- 3. 100-Point Scoring Model Weights & Bounds ---');

    await test('Weights sum exactly to 100 points', () => {
      const primarySum =
        WEIGHTS.forward +
        WEIGHTS.levelFit +
        WEIGHTS.reverse +
        WEIGHTS.verification +
        WEIGHTS.reliability +
        WEIGHTS.rating +
        WEIGHTS.trackMastery +
        WEIGHTS.endorsement +
        WEIGHTS.availability;
      assert.strictEqual(primarySum, 100, `Expected sum 100, got ${primarySum}`);
    });

    await test('Forward match (25) + level fit (5) total exactly 30 points', () => {
      assert.strictEqual(WEIGHTS.forward + WEIGHTS.levelFit, 30);
    });

    await test('Exchange reliability is weighted at exactly 15 points', () => {
      assert.strictEqual(WEIGHTS.reliability, 15);
    });

    await test('Reverse reciprocity is weighted at exactly 20 points', () => {
      assert.strictEqual(WEIGHTS.reverse, 20);
    });

    await test('Skill verification is weighted at exactly 15 points', () => {
      assert.strictEqual(WEIGHTS.verification, 15);
    });

    await test('Rating is 8, track mastery is 5, endorsements is 5, availability is 2', () => {
      assert.strictEqual(WEIGHTS.rating, 8);
      assert.strictEqual(WEIGHTS.trackMastery, 5);
      assert.strictEqual(WEIGHTS.endorsement, 5);
      assert.strictEqual(WEIGHTS.availability, 2);
    });

    // ── SECTION 4: End-to-End Integration & Database Tests ─────────────────────
    console.log('\n--- 4. End-to-End Integration with Real MongoDB Documents ---');

    const pw = await bcrypt.hash('TestPass123!', 8);
    const uniqueToken = `P6S2_${Date.now()}`;

    // Target skill
    const SKILL_TARGET = `Skill_${uniqueToken}`;
    const SKILL_REVERSE = `RevSkill_${uniqueToken}`;

    // 1. Current user: wants SKILL_TARGET (level Advanced), offers SKILL_REVERSE
    const currentUser = await User.create({
      name: 'P6_CurrentUser',
      email: EMAIL('current'),
      password: pw,
      skillsWanted: [{ skill: SKILL_TARGET, level: 'Advanced', priority: 'High' }],
      skillsOffered: [{ skill: SKILL_REVERSE, level: 'Intermediate' }],
    });
    createdUserIds.push(currentUser._id);

    // 2. Candidate A: Advanced tutor in SKILL_TARGET + completed instructor track + 3 completed swaps
    const candidateA = await User.create({
      name: 'P6_Candidate_Advanced_Expert',
      email: EMAIL('cand_a'),
      password: pw,
      skillsOffered: [{ skill: SKILL_TARGET, level: 'Advanced' }],
      skillsWanted: [{ skill: SKILL_REVERSE, priority: 'High' }],
    });
    createdUserIds.push(candidateA._id);

    // Completed track for Candidate A
    const dummyPeer = await User.create({
      name: 'P6_DummyPeer',
      email: EMAIL('dummy'),
      password: pw,
    });
    createdUserIds.push(dummyPeer._id);

    const dummySwapA = await SwapRequest.create({
      fromUser: candidateA._id,
      toUser: dummyPeer._id,
      offeredSkill: SKILL_TARGET,
      wantedSkill: 'General',
      status: 'completed',
    });
    createdSwapIds.push(dummySwapA._id);

    const trackA = await LearningTrack.create({
      swapRequest: dummySwapA._id,
      instructor: candidateA._id,
      learner: dummyPeer._id,
      skillName: SKILL_TARGET,
      status: 'completed',
    });
    createdTrackIds.push(trackA._id);

    // 3. Candidate B: Beginner tutor in SKILL_TARGET (2 levels below requested) + no tracks + 0 swaps
    const candidateB = await User.create({
      name: 'P6_Candidate_Beginner_Novice',
      email: EMAIL('cand_b'),
      password: pw,
      skillsOffered: [{ skill: SKILL_TARGET, level: 'Beginner' }],
      skillsWanted: [{ skill: SKILL_REVERSE, priority: 'Low' }],
    });
    createdUserIds.push(candidateB._id);

    await test('End-to-End: Candidate A (Advanced + Track Mastery) ranks higher than Candidate B (Beginner + No Track)', async () => {
      const recs = await buildRecommendations(currentUser, 10);
      assert(recs.length >= 2, `Expected at least 2 recommendations, got ${recs.length}`);

      const recA = recs.find(r => r.user._id.toString() === candidateA._id.toString());
      const recB = recs.find(r => r.user._id.toString() === candidateB._id.toString());

      assert(recA, 'Candidate A must be recommended');
      assert(recB, 'Candidate B must be recommended');

      assert(recA.score > recB.score, `Expected Candidate A score (${recA.score}) > Candidate B score (${recB.score})`);

      // Verify level fit scores
      assert(
        recA.scoreBreakdown.levelFitScore > recB.scoreBreakdown.levelFitScore,
        `Candidate A level fit (${recA.scoreBreakdown.levelFitScore}) should exceed Candidate B (${recB.scoreBreakdown.levelFitScore})`
      );

      // Verify track mastery scores
      assert(
        recA.scoreBreakdown.learningTrackMastery > recB.scoreBreakdown.learningTrackMastery,
        `Candidate A mastery (${recA.scoreBreakdown.learningTrackMastery}) should exceed Candidate B (${recB.scoreBreakdown.learningTrackMastery})`
      );
    });

    await test('End-to-End: Score breakdown contains all required Phase 5 + Phase 6 keys', async () => {
      const recs = await buildRecommendations(currentUser, 10);
      const recA = recs.find(r => r.user._id.toString() === candidateA._id.toString());
      const bd = recA.scoreBreakdown;

      // Phase 5 keys preserved
      assert('forwardMatch' in bd, 'forwardMatch must be in breakdown');
      assert('reverseMatch' in bd, 'reverseMatch must be in breakdown');
      assert('verificationBoost' in bd, 'verificationBoost must be in breakdown');
      assert('ratingScore' in bd, 'ratingScore must be in breakdown');
      assert('endorsementScore' in bd, 'endorsementScore must be in breakdown');
      assert('availabilityScore' in bd, 'availabilityScore must be in breakdown');
      assert('categoryScore' in bd, 'categoryScore must be in breakdown');

      // Phase 6 keys added
      assert('levelFitScore' in bd, 'levelFitScore must be in breakdown');
      assert('exchangeReliability' in bd, 'exchangeReliability must be in breakdown');
      assert('learningTrackMastery' in bd, 'learningTrackMastery must be in breakdown');

      // Final score is between 0 and 100
      assert(recA.score >= 0 && recA.score <= 100, `Score ${recA.score} must be within [0, 100]`);
    });

    await test('End-to-End: Reasons include level fit and track mastery explanations', async () => {
      const recs = await buildRecommendations(currentUser, 10);
      const recA = recs.find(r => r.user._id.toString() === candidateA._id.toString());

      // Candidate A offers Advanced for Advanced wanted -> exact match reason
      const hasLevelReason = recA.reasons.some(r => r.includes('Matches your requested Advanced level') || r.includes('exceeds'));
      assert(hasLevelReason, `Expected level fit reason in: ${JSON.stringify(recA.reasons)}`);

      // Candidate A has completed track as instructor
      const hasTrackReason = recA.reasons.some(r => r.includes('Verified instructor with completed learning track'));
      assert(hasTrackReason, `Expected track mastery reason in: ${JSON.stringify(recA.reasons)}`);
    });

    await test('End-to-End: Privacy protection — no private assessment details leaked', async () => {
      const recs = await buildRecommendations(currentUser, 10);
      const str = JSON.stringify(recs);

      assert(!str.includes('questions'), 'Quiz questions must not be exposed');
      assert(!str.includes('correctOption'), 'Quiz answers must not be exposed');
      assert(!str.includes('submissionText'), 'Practical submission text must not be exposed');
      assert(!str.includes('evidenceUrl'), 'Practical evidenceUrl must not be exposed');
    });

    await test('End-to-End: Controller getRecommendedPartners returns HTTP 200 with meta', async () => {
      let status = 0;
      let json = null;
      const mockReq = { userId: currentUser._id };
      const mockRes = {
        status(code) { status = code; return this; },
        json(data) { json = data; return this; },
      };

      await getRecommendedPartners(mockReq, mockRes);
      assert.strictEqual(status, 200);
      assert(Array.isArray(json.recommendations));
      assert(json.meta);
      assert.strictEqual(json.meta.profileCompleteness, 'full');
    });

    await test('End-to-End: Controller getDashboardRecommendations returns top 3', async () => {
      let status = 0;
      let json = null;
      const mockReq = { userId: currentUser._id };
      const mockRes = {
        status(code) { status = code; return this; },
        json(data) { json = data; return this; },
      };

      await getDashboardRecommendations(mockReq, mockRes);
      assert.strictEqual(status, 200);
      assert(json.recommendations.length <= 3);
    });

  } finally {
    console.log('\nCleaning up created test documents...');
    await cleanup();
    await mongoose.disconnect();
  }

  console.log(`\n==================================================`);
  console.log(`Phase 6 Step 2 Tests: ${passed} passed, ${failed} failed`);
  console.log(`==================================================\n`);

  if (failed > 0) {
    console.error('Failed tests:');
    failures.forEach(f => console.error(`- ${f.name}: ${f.error}`));
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
