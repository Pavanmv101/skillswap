/**
 * Phase 6 — Advanced Skill Exchange Algorithm (Step 2)
 * controllers/recommendationController.js
 *
 * Upgraded scoring engine with:
 * - Directional skill-level expertise compatibility (tutor vs learner)
 * - Demonstrated learning track mastery (instructor/learner completion & practical assessments)
 * - Exchange reliability integration via services/reliabilityService.js (single-query batching)
 *
 * Scoring weights (sum = 100):
 *   Forward match            25 pts  (they offer what I want, priority-weighted)
 *   Level fit                 5 pts  (tutor expertise meets or exceeds requested level)
 *   Reverse reciprocity      20 pts  (I offer what they want, priority-weighted)
 *   Skill verification       15 pts  (admin-approved SkillVerification records)
 *   Exchange reliability     15 pts  (Bayesian smoothed exchange completion rate)
 *   Bayesian rating           8 pts  (confidence-aware adjusted rating)
 *   Learning track mastery    5 pts  (verified course completion / practicals)
 *   Peer endorsements         5 pts  (peer endorsements on matched skills)
 *   Availability              2 pts  (overlapping time-slots)
 *   ─────────────────────────────────
 *   Total                   100 pts
 *
 * Backward-compatible: retains categoryScore in scoreBreakdown for Phase 5 frontend compatibility.
 * All scoring is rule-based, fully transparent, and computed server-side only.
 * No ML, no paid APIs, no external services.
 */

'use strict';

const User                  = require('../models/User');
const SwapRequest           = require('../models/SwapRequest');
const Endorsement           = require('../models/Endorsement');
const Rating                = require('../models/Rating');
const SkillVerification      = require('../models/SkillVerification');
const LearningTrack         = require('../models/LearningTrack');
const { getBatchExchangeReliability } = require('../services/reliabilityService');
const { findCircularCycles }  = require('../services/cycleDetectionService');

// ─── Constants ────────────────────────────────────────────────────────────────

const WEIGHTS = {
  forward:      25,
  levelFit:      5,
  reverse:      20,
  verification: 15,
  reliability:  15,
  rating:        8,
  trackMastery:  5,
  endorsement:   5,
  availability:  2,
  category:      2, // Preserved in scoreBreakdown for Phase 5 frontend compatibility
};

// Confidence-aware rating: global prior (mean rating on the platform = 3.5, weight = 5 pseudo-ratings)
const PRIOR_RATING    = 3.5;
const PRIOR_WEIGHT    = 5;

// Priority multipliers for skillsWanted entries
const PRIORITY_WEIGHT = { High: 1.0, Medium: 0.7, Low: 0.4 };

// Skill level numeric rank mapping
const LEVEL_VALUES = {
  beginner:     1,
  intermediate: 2,
  advanced:     3,
};

// Fields returned for every recommended user — never exposes passwords, certs, or admin data
const PUBLIC_USER_FIELDS =
  'name bio skillsOffered skillsWanted availabilitySlots availability averageRating totalRatings';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Normalise a raw value to [0, 1]. Returns 0 if max is 0.
 */
function norm(value, max) {
  if (!max || max === 0) return 0;
  return Math.min(1, Math.max(0, value / max));
}

/**
 * Lowercase, trimmed list of skill names from an array of skill objects.
 */
function skillNames(arr = []) {
  return arr.map(s => s.skill.trim().toLowerCase());
}

/**
 * Normalise a level string to lowercase known token, or null.
 */
function normalizeLevel(level) {
  if (!level || typeof level !== 'string') return null;
  const l = level.trim().toLowerCase();
  return LEVEL_VALUES[l] ? l : null;
}

/**
 * Directional level compatibility: tutor's offered level vs learner's requested level.
 * Returns score in [0, 1].
 *
 * Logic:
 * - If learner did not specify an explicit requested level:
 *   - Advanced tutor: 1.0
 *   - Intermediate tutor: 0.85
 *   - Beginner tutor: 0.70
 * - If learner specified a level:
 *   - diff = tutorRank - learnerRank
 *   - diff > 0 (Tutor exceeds requested level): 1.0
 *   - diff === 0 (Exact match): 0.95
 *   - diff === -1 (1 level below requested): 0.45
 *   - diff <= -2 (2 levels below requested, e.g. Beginner teaching Advanced): 0.15
 */
function computeSkillLevelCompatibility(tutorLevelStr, learnerLevelStr) {
  const tutorNorm = normalizeLevel(tutorLevelStr);
  const learnerNorm = normalizeLevel(learnerLevelStr);

  const tutorRank = tutorNorm ? LEVEL_VALUES[tutorNorm] : 1; // default to Beginner (1) if unknown

  if (!learnerNorm) {
    if (tutorRank === 3) return 1.0;
    if (tutorRank === 2) return 0.85;
    return 0.70;
  }

  const learnerRank = LEVEL_VALUES[learnerNorm];
  const diff = tutorRank - learnerRank;

  if (diff > 0) {
    return 1.0;
  } else if (diff === 0) {
    return 0.95;
  } else if (diff === -1) {
    return 0.45;
  } else {
    return 0.15;
  }
}

/**
 * Compute candidate's overall level fit across all forward-matched skills.
 * Priority-weighted by the learner's wanted skill priority.
 */
function computeCandidateLevelFit(myWanted = [], candidateOffered = [], matchedSkills = []) {
  if (!matchedSkills || matchedSkills.length === 0) {
    return { score: 0, details: [] };
  }

  let totalWeight = 0;
  let weightedScore = 0;
  const details = [];

  for (const skillName of matchedSkills) {
    const want = myWanted.find(w => w.skill.trim().toLowerCase() === skillName.toLowerCase());
    const offer = candidateOffered.find(o => o.skill.trim().toLowerCase() === skillName.toLowerCase());
    const weight = PRIORITY_WEIGHT[want?.priority] ?? PRIORITY_WEIGHT.Medium;

    const comp = computeSkillLevelCompatibility(offer?.level, want?.level);
    weightedScore += comp * weight;
    totalWeight += weight;

    details.push({
      skill: skillName,
      tutorLevel: offer?.level || 'Beginner',
      learnerLevel: want?.level || null,
      compatibility: comp,
    });
  }

  const score = totalWeight > 0 ? (weightedScore / totalWeight) : 0;
  return { score, details };
}

/**
 * Map candidate tracks to a fast lookup structure:
 * candidateId -> { [skillLow]: { instructorCompleted: bool, learnerCompleted: bool, practicalPassed: bool } }
 */
function buildTrackMasteryMap(candidateTracks = [], candidateIds = []) {
  const masteryMap = {};
  for (const cid of candidateIds) {
    masteryMap[cid.toString()] = {};
  }

  for (const track of candidateTracks) {
    const skillLow = (track.skillName || '').trim().toLowerCase();
    if (!skillLow) continue;

    const isCompleted = track.status === 'completed';
    const hasPractical = (track.assessments || []).some(
      a => a.type === 'practical' && a.evaluationStatus === 'evaluated' && a.passed === true
    );

    const instId = track.instructor ? track.instructor.toString() : null;
    const lrnId = track.learner ? track.learner.toString() : null;

    if (instId && masteryMap[instId]) {
      if (!masteryMap[instId][skillLow]) {
        masteryMap[instId][skillLow] = {
          instructorCompleted: false,
          learnerCompleted: false,
          practicalPassed: false,
        };
      }
      if (isCompleted) masteryMap[instId][skillLow].instructorCompleted = true;
    }

    if (lrnId && masteryMap[lrnId]) {
      if (!masteryMap[lrnId][skillLow]) {
        masteryMap[lrnId][skillLow] = {
          instructorCompleted: false,
          learnerCompleted: false,
          practicalPassed: false,
        };
      }
      if (isCompleted) masteryMap[lrnId][skillLow].learnerCompleted = true;
      if (hasPractical) masteryMap[lrnId][skillLow].practicalPassed = true;
    }
  }

  return masteryMap;
}

/**
 * Score learning track mastery for matched skills.
 * Capped per skill (max achievement taken, duplicate tracks prevented).
 * Never leaks private assessment or submission details.
 */
function scoreTrackMastery(candidateMastery = {}, matchedSkills = []) {
  if (!matchedSkills || matchedSkills.length === 0 || !candidateMastery) {
    return { score: 0, achievements: [] };
  }

  let totalScore = 0;
  const achievements = [];

  for (const skillName of matchedSkills) {
    const low = skillName.trim().toLowerCase();
    const m = candidateMastery[low];
    if (!m) continue;

    let skillScore = 0;
    if (m.instructorCompleted) {
      skillScore = 1.0;
      achievements.push({ skill: skillName, type: 'instructor', label: `Verified instructor with completed learning track in ${skillName}` });
    } else if (m.learnerCompleted) {
      skillScore = 0.85;
      achievements.push({ skill: skillName, type: 'graduate', label: `Completed verified learning track in ${skillName}` });
    } else if (m.practicalPassed) {
      skillScore = 0.70;
      achievements.push({ skill: skillName, type: 'practical', label: `Passed evaluated practical assessment in ${skillName}` });
    }

    totalScore += skillScore;
  }

  const score = norm(totalScore, matchedSkills.length);
  return { score, achievements };
}

/**
 * Confidence-aware (Bayesian) adjusted rating normalised to [0, 1].
 * Users with zero ratings receive the prior (neutral) rating, not a penalty.
 *
 * adjusted = (n * avgRating + W * prior) / (n + W)
 * normalised = (adjusted - 1) / 4   (maps [1..5] → [0..1])
 */
function bayesianRatingScore(averageRating, totalRatings) {
  const n   = totalRatings   || 0;
  const avg = averageRating  || 0;
  const adjusted = (n * avg + PRIOR_WEIGHT * PRIOR_RATING) / (n + PRIOR_WEIGHT);
  return norm(adjusted - 1, 4); // maps [1..5] → [0..1]
}

/**
 * Compute priority-weighted forward-match score ∈ [0, 1].
 * Forward = they offer skills that I want.
 *
 * Each matched want contributes PRIORITY_WEIGHT[priority] to the raw score.
 * Max possible = sum of all my want priorities (normalised to that max).
 */
function forwardMatchScore(myWanted, theirOfferedLow) {
  if (!myWanted || myWanted.length === 0) return { score: 0, matched: [] };

  let raw = 0;
  let maxRaw = 0;
  const matched = [];

  for (const want of myWanted) {
    const multiplier = PRIORITY_WEIGHT[want.priority] ?? PRIORITY_WEIGHT.Medium;
    maxRaw += multiplier;
    if (theirOfferedLow.includes(want.skill.trim().toLowerCase())) {
      raw += multiplier;
      matched.push(want.skill.trim());
    }
  }

  return { score: norm(raw, maxRaw), matched };
}

/**
 * Compute priority-weighted reverse-match score ∈ [0, 1].
 * Reverse = I offer skills that they want.
 */
function reverseMatchScore(theirWanted, myOfferedLow) {
  if (!theirWanted || theirWanted.length === 0) return { score: 0, matched: [] };

  let raw = 0;
  let maxRaw = 0;
  const matched = [];

  for (const want of theirWanted) {
    const multiplier = PRIORITY_WEIGHT[want.priority] ?? PRIORITY_WEIGHT.Medium;
    maxRaw += multiplier;
    if (myOfferedLow.includes(want.skill.trim().toLowerCase())) {
      raw += multiplier;
      matched.push(want.skill.trim());
    }
  }

  return { score: norm(raw, maxRaw), matched };
}

/**
 * Availability overlap score ∈ [0, 1].
 * Fraction of MY time-slots that overlap with at least one of theirs.
 * Returns null if either user has no availability data.
 */
function availabilityScore(mySlots, theirSlots) {
  if (!mySlots || !theirSlots || mySlots.length === 0 || theirSlots.length === 0) {
    return { score: 0, overlap: null };
  }

  let overlapCount = 0;
  for (const mine of mySlots) {
    for (const theirs of theirSlots) {
      if (mine.day === theirs.day && mine.from < theirs.to && theirs.from < mine.to) {
        overlapCount++;
        break; // count each of MY slots at most once
      }
    }
  }

  const score   = norm(overlapCount, mySlots.length);
  const overlap = overlapCount > 0; // boolean for UI badge
  return { score, overlap };
}

/**
 * Category affinity score ∈ [0, 1].
 * Fraction of matched forward-skills whose category matches
 * the corresponding want's category.
 */
function categoryAffinityScore(myWanted, candidateOffered, matchedSkillNames) {
  if (matchedSkillNames.length === 0) return 0;

  const wantCatMap  = {};
  for (const w of myWanted) {
    wantCatMap[w.skill.trim().toLowerCase()] = (w.category || 'General').toLowerCase();
  }

  const offerCatMap = {};
  for (const o of candidateOffered) {
    offerCatMap[o.skill.trim().toLowerCase()] = (o.category || 'General').toLowerCase();
  }

  let hits = 0;
  for (const name of matchedSkillNames) {
    const low = name.trim().toLowerCase();
    if (wantCatMap[low] && offerCatMap[low] && wantCatMap[low] === offerCatMap[low]) {
      hits++;
    }
  }

  return norm(hits, matchedSkillNames.length);
}

/**
 * Build human-readable reason strings for a candidate.
 */
function buildReasons({
  forwardMatched,
  reverseMatched,
  verifiedMatchedSkills,
  bayesianRating,
  totalRatings,
  endorsementCount,
  availOverlap,
  levelDetails = [],
  trackAchievements = [],
  reliabilityScore = 0.70,
  completedSwaps = 0,
}) {
  const reasons = [];

  // 1. Forward match & verification
  if (forwardMatched.length > 0) {
    const verified = forwardMatched.filter(s => verifiedMatchedSkills.includes(s.toLowerCase()));
    const plain    = forwardMatched.filter(s => !verifiedMatchedSkills.includes(s.toLowerCase()));
    if (verified.length > 0)
      reasons.push(`Teaches ${verified.map(s => `${s} ✓`).join(', ')} (admin-verified) — skills you want`);
    if (plain.length > 0)
      reasons.push(`Offers ${plain.join(', ')} — matching your learning goals`);
  }

  // 2. Reverse match
  if (reverseMatched.length > 0) {
    reasons.push(`Wants ${reverseMatched.join(', ')} — skills you can teach`);
  }

  // 3. Level fit
  for (const d of levelDetails) {
    if (d.learnerLevel) {
      const tutorRank = LEVEL_VALUES[normalizeLevel(d.tutorLevel)] || 1;
      const learnerRank = LEVEL_VALUES[normalizeLevel(d.learnerLevel)] || 1;
      if (tutorRank > learnerRank) {
        reasons.push(`Tutor (${d.tutorLevel}) exceeds your requested level in ${d.skill}`);
      } else if (tutorRank === learnerRank) {
        reasons.push(`Matches your requested ${d.tutorLevel} level in ${d.skill}`);
      }
    } else if (normalizeLevel(d.tutorLevel) === 'advanced') {
      reasons.push(`Advanced tutor in ${d.skill}`);
    }
  }

  // 4. Learning track mastery
  for (const ach of trackAchievements) {
    reasons.push(ach.label);
  }

  // 5. Exchange reliability
  if (completedSwaps >= 1 && reliabilityScore >= 0.80) {
    reasons.push(`High exchange completion record (${Math.round(reliabilityScore * 100)}% reliability)`);
  }

  // 6. Rating
  if (totalRatings >= 3) {
    const display = (bayesianRating * 4 + 1).toFixed(1); // reverse-normalise for display
    reasons.push(`⭐ Rated ${display}/5 across ${totalRatings} sessions`);
  } else if (totalRatings > 0) {
    reasons.push(`⭐ ${totalRatings} session rating(s) so far`);
  }

  // 7. Endorsements
  if (endorsementCount > 0) {
    reasons.push(`${endorsementCount} peer endorsement${endorsementCount > 1 ? 's' : ''} on matched skills`);
  }

  // 8. Schedule
  if (availOverlap === true) {
    reasons.push('⏰ Schedule overlaps with yours');
  }

  return reasons;
}

// ─── Main Recommendation Logic ────────────────────────────────────────────────

async function buildRecommendations(currentUser, limit = 20) {
  const myId         = currentUser._id;
  const myOfferedLow = skillNames(currentUser.skillsOffered);
  const myWantedLow  = skillNames(currentUser.skillsWanted);
  const myWanted     = currentUser.skillsWanted  || [];
  const myOffered    = currentUser.skillsOffered || [];
  const blockedIds   = (currentUser.blockedUsers || []).map(id => id.toString());

  // ── 1. Fetch already-connected pair IDs (pending or accepted) ──────────────
  const connectedSwaps = await SwapRequest.find({
    $or: [
      { fromUser: myId, status: { $in: ['pending', 'accepted'] } },
      { toUser:   myId, status: { $in: ['pending', 'accepted'] } },
    ],
  }).select('fromUser toUser');

  const connectedUserIds = new Set();
  for (const swap of connectedSwaps) {
    const other = swap.fromUser.toString() === myId.toString()
      ? swap.toUser.toString()
      : swap.fromUser.toString();
    connectedUserIds.add(other);
  }

  // ── 2. Candidate query (forward OR reverse overlap, excludes self & blocked) ─
  const excludeIds = [myId, ...blockedIds.map(id => id)];

  let candidateQuery = {};
  if (myWantedLow.length > 0 && myOfferedLow.length > 0) {
    candidateQuery = {
      $or: [
        { 'skillsOffered.skill': { $in: myWanted.map(s => s.skill) } },
        { 'skillsWanted.skill':  { $in: myOffered.map(s => s.skill) } },
      ],
    };
  } else if (myWantedLow.length > 0) {
    candidateQuery = { 'skillsOffered.skill': { $in: myWanted.map(s => s.skill) } };
  } else if (myOfferedLow.length > 0) {
    candidateQuery = { 'skillsWanted.skill': { $in: myOffered.map(s => s.skill) } };
  } else {
    // Empty profile — return empty gracefully
    return [];
  }

  const candidates = await User.find({
    ...candidateQuery,
    _id:          { $nin: excludeIds },
    blockedUsers: { $ne: myId },
    role:         { $ne: 'admin' },
  }).select(PUBLIC_USER_FIELDS);

  if (candidates.length === 0) return [];

  // ── 3. Batch-fetch supporting data for ALL candidates at once ──────────────
  const candidateIds = candidates.map(c => c._id);

  // A. Admin-verified SkillVerification records for matched candidates
  const verifications = await SkillVerification.find({
    user:   { $in: candidateIds },
    status: 'verified',
  }).select('user skillName');

  const verifiedMap = {};
  for (const v of verifications) {
    const uid = v.user.toString();
    if (!verifiedMap[uid]) verifiedMap[uid] = new Set();
    verifiedMap[uid].add(v.skillName.trim().toLowerCase());
  }

  // B. Endorsements on candidates received from any user (scoped to matched skills)
  const endorsements = await Endorsement.find({
    recipient: { $in: candidateIds },
  }).select('recipient skillName');

  const endorseMap = {};
  for (const e of endorsements) {
    const uid = e.recipient.toString();
    if (!endorseMap[uid]) endorseMap[uid] = {};
    const skill = e.skillName.trim().toLowerCase();
    endorseMap[uid][skill] = (endorseMap[uid][skill] || 0) + 1;
  }

  // C. Learning tracks for candidate mastery (batched in a single query)
  const candidateTracks = await LearningTrack.find({
    $and: [
      {
        $or: [
          { instructor: { $in: candidateIds } },
          { learner:    { $in: candidateIds } },
        ],
      },
      {
        $or: [
          { status: 'completed' },
          { 'assessments.evaluationStatus': 'evaluated', 'assessments.passed': true },
        ],
      },
    ],
  }).select('instructor learner skillName status assessments.type assessments.evaluationStatus assessments.passed');

  const trackMasteryMap = buildTrackMasteryMap(candidateTracks, candidateIds);

  // D. Exchange reliability for candidates (batched in a single query via reliabilityService)
  let reliabilityMap = new Map();
  try {
    reliabilityMap = await getBatchExchangeReliability(candidateIds);
  } catch (err) {
    console.error('[Recommendations] Reliability fetch error, using neutral priors:', err.message);
  }

  // ── 4. Score each candidate ────────────────────────────────────────────────
  const scored = [];

  for (const candidate of candidates) {
    const cid             = candidate._id.toString();
    const theirOfferedLow = skillNames(candidate.skillsOffered);
    const theirWanted     = candidate.skillsWanted || [];

    // Forward match
    const fwd = forwardMatchScore(myWanted, theirOfferedLow);

    // Reverse match
    const rev = reverseMatchScore(theirWanted, myOfferedLow);

    // Skip candidates with zero signal in both directions
    if (fwd.score === 0 && rev.score === 0) continue;

    // Level compatibility
    const levelFit = computeCandidateLevelFit(myWanted, candidate.skillsOffered, fwd.matched);

    // Learning track mastery
    const trackMastery = scoreTrackMastery(trackMasteryMap[cid], fwd.matched);

    // Exchange reliability
    const relData = reliabilityMap.get(cid) || { score: 0.70, completedCount: 0, failedCount: 0 };
    const relScore = typeof relData.score === 'number' ? relData.score : 0.70;

    // Verification: fraction of forward-matched skills that are admin-verified
    const verifiedSet     = verifiedMap[cid] || new Set();
    const verifiedMatched = fwd.matched.filter(s => verifiedSet.has(s.toLowerCase()));
    const verifyScore     = fwd.matched.length > 0
      ? norm(verifiedMatched.length, fwd.matched.length)
      : 0;

    // Rating: Bayesian adjusted score
    const ratingScore = bayesianRatingScore(candidate.averageRating, candidate.totalRatings);

    // Endorsements on matched skills
    const cEndorseMap    = endorseMap[cid] || {};
    let endorseCount     = 0;
    for (const skillName of fwd.matched) {
      endorseCount += cEndorseMap[skillName.toLowerCase()] || 0;
    }
    // Normalise: cap at 5 endorsements across matched skills
    const endorseScore = norm(Math.min(endorseCount, 5), 5);

    // Availability
    const { score: availScore, overlap: availOverlap } = availabilityScore(
      currentUser.availabilitySlots,
      candidate.availabilitySlots
    );

    // Category affinity (retained for backward compatibility)
    const catScore = categoryAffinityScore(myWanted, candidate.skillsOffered, fwd.matched);

    // ── Final weighted score (0–100) ─────────────────────────────────────────
    const finalScore = Math.round(
      fwd.score          * WEIGHTS.forward      +
      levelFit.score     * WEIGHTS.levelFit     +
      rev.score          * WEIGHTS.reverse      +
      verifyScore        * WEIGHTS.verification +
      relScore           * WEIGHTS.reliability  +
      ratingScore        * WEIGHTS.rating       +
      trackMastery.score * WEIGHTS.trackMastery +
      endorseScore       * WEIGHTS.endorsement  +
      availScore         * WEIGHTS.availability
    );

    // ── Reason strings ────────────────────────────────────────────────────────
    const reasons = buildReasons({
      forwardMatched:        fwd.matched,
      reverseMatched:        rev.matched,
      verifiedMatchedSkills: [...verifiedSet],
      bayesianRating:        ratingScore,
      totalRatings:          candidate.totalRatings || 0,
      endorsementCount:      endorseCount,
      availOverlap,
      levelDetails:          levelFit.details,
      trackAchievements:     trackMastery.achievements,
      reliabilityScore:      relScore,
      completedSwaps:        relData.completedCount || 0,
    });

    scored.push({
      user: {
        _id:               candidate._id,
        name:              candidate.name,
        bio:               candidate.bio,
        skillsOffered:     candidate.skillsOffered,
        skillsWanted:      candidate.skillsWanted,
        availabilitySlots: candidate.availabilitySlots,
        availability:      candidate.availability,
        averageRating:     candidate.averageRating,
        totalRatings:      candidate.totalRatings,
      },
      score: Math.min(100, Math.max(0, finalScore)),
      scoreBreakdown: {
        forwardMatch:         Math.round(fwd.score          * WEIGHTS.forward),
        levelFitScore:        Math.round(levelFit.score     * WEIGHTS.levelFit),
        reverseMatch:         Math.round(rev.score          * WEIGHTS.reverse),
        verificationBoost:    Math.round(verifyScore        * WEIGHTS.verification),
        exchangeReliability:  Math.round(relScore           * WEIGHTS.reliability),
        ratingScore:          Math.round(ratingScore        * WEIGHTS.rating),
        learningTrackMastery: Math.round(trackMastery.score * WEIGHTS.trackMastery),
        endorsementScore:     Math.round(endorseScore       * WEIGHTS.endorsement),
        availabilityScore:    Math.round(availScore         * WEIGHTS.availability),
        categoryScore:        Math.round(catScore           * WEIGHTS.category),
      },
      reasons,
      matchedWants:     fwd.matched,
      matchedOffers:    rev.matched,
      alreadyConnected: connectedUserIds.has(cid),
      availabilityOverlap: availOverlap,
    });
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, limit);
}

// ─── Controllers ──────────────────────────────────────────────────────────────

/**
 * GET /api/recommendations/partners
 * Returns up to 20 ranked partner recommendations.
 */
exports.getRecommendedPartners = async (req, res) => {
  try {
    const currentUser = await User.findById(req.userId).select(
      'skillsOffered skillsWanted availabilitySlots blockedUsers'
    );
    if (!currentUser) return res.status(404).json({ message: 'User not found' });

    const hasProfile =
      currentUser.skillsOffered.length > 0 || currentUser.skillsWanted.length > 0;

    if (!hasProfile) {
      return res.status(200).json({
        recommendations: [],
        meta: {
          totalCandidates:    0,
          profileCompleteness: 'empty',
          message: 'Complete your profile by adding skills you offer or want to learn to receive personalised recommendations.',
        },
      });
    }

    const recommendations = await buildRecommendations(currentUser, 20);

    const completeness =
      currentUser.skillsOffered.length > 0 && currentUser.skillsWanted.length > 0
        ? 'full'
        : currentUser.skillsWanted.length === 0
        ? 'offers_only'
        : 'wants_only';

    return res.status(200).json({
      recommendations,
      meta: {
        totalCandidates:    recommendations.length,
        profileCompleteness: completeness,
        computedAt:         new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('[Recommendations] Partners error:', err.message);
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};

/**
 * GET /api/recommendations/dashboard
 * Lightweight endpoint — top 3 recommendations for the Dashboard widget.
 */
exports.getDashboardRecommendations = async (req, res) => {
  try {
    const currentUser = await User.findById(req.userId).select(
      'skillsOffered skillsWanted availabilitySlots blockedUsers'
    );
    if (!currentUser) return res.status(404).json({ message: 'User not found' });

    const hasProfile =
      currentUser.skillsOffered.length > 0 || currentUser.skillsWanted.length > 0;

    if (!hasProfile) {
      return res.status(200).json({ recommendations: [], meta: { profileCompleteness: 'empty' } });
    }

    const recommendations = await buildRecommendations(currentUser, 3);

    return res.status(200).json({
      recommendations,
      meta: { profileCompleteness: 'partial', computedAt: new Date().toISOString() },
    });
  } catch (err) {
    console.error('[Recommendations] Dashboard error:', err.message);
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};

/**
 * GET /api/recommendations/skills
 * Suggests skills the current user should consider learning,
 * based on actual platform data (what high-compatibility peers offer).
 *
 * Excludes skills the user already offers or wants.
 * Includes explanation and potential partner counts.
 */
exports.getSkillSuggestions = async (req, res) => {
  try {
    const currentUser = await User.findById(req.userId).select(
      'skillsOffered skillsWanted blockedUsers'
    );
    if (!currentUser) return res.status(404).json({ message: 'User not found' });

    const myOfferedLow = skillNames(currentUser.skillsOffered);
    const myWantedLow  = skillNames(currentUser.skillsWanted);
    const myKnownLow   = new Set([...myOfferedLow, ...myWantedLow]);
    const blockedIds   = (currentUser.blockedUsers || []).map(id => id.toString());

    // Fetch all non-blocked, non-admin users who offer skills
    const otherUsers = await User.find({
      _id:          { $nin: [req.userId, ...blockedIds] },
      blockedUsers: { $ne: req.userId },
      role:         { $ne: 'admin' },
      'skillsOffered.0': { $exists: true },
    }).select('skillsOffered skillsWanted');

    if (otherUsers.length === 0) {
      return res.status(200).json({
        suggestedSkills: [],
        meta: { message: 'Not enough platform data to generate suggestions yet.' },
      });
    }

    // Tally: for each skill not already known, count how many users offer it
    const skillTally = {}; // skillLow → { displayName, category, offeringCount }

    for (const user of otherUsers) {
      for (const offered of (user.skillsOffered || [])) {
        const low = offered.skill.trim().toLowerCase();
        if (myKnownLow.has(low)) continue;
        if (!skillTally[low]) {
          skillTally[low] = {
            displayName:    offered.skill.trim(),
            category:       offered.category || 'General',
            offeringCount:  0,
          };
        }
        skillTally[low].offeringCount++;
      }
    }

    if (Object.keys(skillTally).length === 0) {
      return res.status(200).json({
        suggestedSkills: [],
        meta: { message: 'Your profile already covers the most common skills on the platform.' },
      });
    }

    // Sort by offering count descending, return top 8
    const suggestions = Object.values(skillTally)
      .sort((a, b) => b.offeringCount - a.offeringCount)
      .slice(0, 8)
      .map(s => ({
        skill:             s.displayName,
        category:          s.category,
        potentialPartners: s.offeringCount,
        reason:            `${s.offeringCount} student${s.offeringCount > 1 ? 's' : ''} on SkillSwap already teach${s.offeringCount === 1 ? 'es' : ''} ${s.displayName} and could be your learning partner`,
      }));

    return res.status(200).json({
      suggestedSkills: suggestions,
      meta: {
        totalSkillsAnalysed: Object.keys(skillTally).length,
        computedAt:          new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('[Recommendations] Skills error:', err.message);
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};

/**
 * GET /api/recommendations/circular
 * Returns up to 5 ranked 3-way circular skill exchange cycles for the authenticated user.
 */
exports.getCircularRecommendations = async (req, res) => {
  try {
    const currentUser = await User.findById(req.userId).select(
      'name bio skillsOffered skillsWanted availabilitySlots blockedUsers averageRating totalRatings'
    );
    if (!currentUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    const recommendations = await findCircularCycles(currentUser, { limit: 5 });
    return res.status(200).json(recommendations);
  } catch (err) {
    console.error('[Recommendations] Circular error:', err.message);
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ─── Exported Helpers for Testing ─────────────────────────────────────────────
exports.computeSkillLevelCompatibility = computeSkillLevelCompatibility;
exports.computeCandidateLevelFit       = computeCandidateLevelFit;
exports.buildTrackMasteryMap           = buildTrackMasteryMap;
exports.scoreTrackMastery              = scoreTrackMastery;
exports.WEIGHTS                        = WEIGHTS;
exports.buildRecommendations           = buildRecommendations;
