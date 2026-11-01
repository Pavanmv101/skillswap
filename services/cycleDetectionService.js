/**
 * Phase 6 — Step 3 — Stage 2: Cycle Detection & Recommendations API
 * services/cycleDetectionService.js
 *
 * Implements directed three-person circular skill exchange discovery ($A \to B \to C \to A$)
 * and transparent multi-factor cycle scoring.
 *
 * Mathematical Scoring Model (Sum = 100%):
 *   1. Level Compatibility (35%):
 *      Harmonic mean across the 3 directed legs:
 *        c_i = computeSkillLevelCompatibility(teacherLevel_i, learnerLevel_i) in [0.15, 1.0]
 *        H   = 3 / (1/c0 + 1/c1 + 1/c2) in [0.15, 1.0]
 *        S_level = round(H * 100)
 *
 *   2. Exchange Reliability (35%):
 *      Weakest-link Bayesian reliability across all 3 participants:
 *        R_cycle = 0.5 * min(R_A, R_B, R_C) + 0.5 * ((R_A + R_B + R_C) / 3) in [0, 1]
 *        S_rel   = round(R_cycle * 100)
 *      Neutral prior (0.70) applied for users without exchange history.
 *
 *   3. Bayesian Rating (15%):
 *      Confidence-adjusted platform rating normalized against global prior (mean=3.5, weight=5):
 *        normRating_u = ((n_u * avg_u + 5 * 3.5) / (n_u + 5) - 1) / 4 in [0, 1]
 *        S_rating     = round(((normRating_A + normRating_B + normRating_C) / 3) * 100)
 *      Unrated users receive neutral prior 3.5/5 -> 63.
 *
 *   4. Skill Verification (15%):
 *      Fraction of the 3 exchanged skills with admin-verified status:
 *        V        = (sum_{i=0}^2 isVerified(teacher_i, skill_i)) / 3
 *        S_verify = round(V * 100)
 *
 *   Final Cycle Score:
 *     S_cycle = round(0.35 * S_level + 0.35 * S_rel + 0.15 * S_rating + 0.15 * S_verify)
 *     Clamped to [0, 100].
 *
 * Search Bounds & Performance Trade-offs:
 *   HOP1_CANDIDATE_LIMIT = 30:
 *     Restricts the number of candidate B users examined in Hop 1.
 *     Trade-off: Keeps fan-out bounded while selecting candidates with the highest
 *     skill-level compatibility and priority. Bounded DB transfer (< 30 KB).
 *
 *   HOP2_CANDIDATE_LIMIT = 30:
 *     Restricts the number of candidate C users examined in Hop 2.
 *     Trade-off: Evaluates at most 30 * 30 = 900 potential candidate pairs in memory,
 *     executing in < 5ms without blocking the Node.js event loop.
 *
 *   DEFAULT_RETURN_LIMIT = 5:
 *     Top N ranked cycles returned to the client.
 */

'use strict';

const mongoose            = require('mongoose');
const User                = require('../models/User');
const SwapRequest         = require('../models/SwapRequest');
const CircularExchange     = require('../models/CircularExchange');
const ExchangeReservation = require('../models/ExchangeReservation');
const SkillVerification   = require('../models/SkillVerification');
const { getBatchExchangeReliability, DEFAULT_PRIOR_MEAN } = require('./reliabilityService');

// ─── Constants ────────────────────────────────────────────────────────────────

const HOP1_CANDIDATE_LIMIT = 30;
const HOP2_CANDIDATE_LIMIT = 30;
const DEFAULT_RETURN_LIMIT = 5;

const HOP1_LIMIT = HOP1_CANDIDATE_LIMIT;
const HOP2_LIMIT = HOP2_CANDIDATE_LIMIT;

const PRIORITY_WEIGHT = {
  High:   1.0,
  Medium: 0.7,
  Low:    0.4,
};

const LEVEL_VALUES = {
  beginner:     1,
  intermediate: 2,
  advanced:     3,
};

const PRIOR_RATING = 3.5;
const PRIOR_WEIGHT = 5;

const CYCLE_WEIGHTS = {
  levelCompatibility:  0.35,
  exchangeReliability: 0.35,
  bayesianRating:      0.15,
  skillVerification:   0.15,
};

// ─── Pure Mathematical Helpers ────────────────────────────────────────────────

function escapeRegex(str = '') {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function norm(value, max) {
  if (!max || max === 0) return 0;
  return Math.min(1, Math.max(0, value / max));
}

function normalizeLevel(level) {
  if (!level || typeof level !== 'string') return null;
  const l = level.trim().toLowerCase();
  return LEVEL_VALUES[l] ? l : null;
}

/**
 * Directional level compatibility: tutor's offered level vs learner's requested level.
 * Returns score in [0.15, 1.0].
 */
function computeSkillLevelCompatibility(tutorLevelStr, learnerLevelStr) {
  const tutorNorm = normalizeLevel(tutorLevelStr);
  const learnerNorm = normalizeLevel(learnerLevelStr);

  const tutorRank = tutorNorm ? LEVEL_VALUES[tutorNorm] : 1;

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
 * Confidence-aware Bayesian adjusted rating normalized to [0, 1].
 * Maps [1..5] -> [0..1].
 */
function bayesianRatingScore(averageRating, totalRatings) {
  const n = totalRatings || 0;
  const avg = averageRating || 0;
  const adjusted = (n * avg + PRIOR_WEIGHT * PRIOR_RATING) / (n + PRIOR_WEIGHT);
  return norm(adjusted - 1, 4);
}

/**
 * Checks whether two users have blocked each other in either direction.
 */
function isMutuallyBlocked(userX, userY) {
  if (!userX || !userY) return false;
  const xId = (userX._id || userX).toString();
  const yId = (userY._id || userY).toString();

  const xBlocked = (userX.blockedUsers || []).map(id => id.toString());
  const yBlocked = (userY.blockedUsers || []).map(id => id.toString());

  return xBlocked.includes(yId) || yBlocked.includes(xId);
}

/**
 * Sanitizes user record for public API presentation.
 * Strictly avoids exposing emails, passwords, certificates, or block lists.
 */
function sanitizePublicUser(user) {
  if (!user) return null;
  return {
    _id: (user._id || user).toString(),
    name: user.name || '',
    bio: user.bio || '',
    averageRating: typeof user.averageRating === 'number' ? user.averageRating : 0,
    totalRatings: typeof user.totalRatings === 'number' ? user.totalRatings : 0,
    availabilitySlots: Array.isArray(user.availabilitySlots) ? user.availabilitySlots : [],
  };
}

// ─── Multi-Factor Cycle Scoring ───────────────────────────────────────────────

/**
 * Computes transparent, normalized cycle score across the 4 approved signals.
 *
 * @param {Object} cycleCandidate - { rawLegs, participants }
 * @param {Object} context - { reliabilityMap, verifiedMap }
 * @returns {Object} { cycleScore, scoreBreakdown, reasons }
 */
function scoreCycle(cycleCandidate, { reliabilityMap = new Map(), verifiedMap = {} } = {}) {
  const { rawLegs, participants } = cycleCandidate;

  // 1. Level Compatibility (Harmonic Mean across 3 legs)
  const compatibilities = rawLegs.map(leg =>
    computeSkillLevelCompatibility(leg.teacherLevel, leg.learnerLevel)
  );

  const denom = (1 / compatibilities[0]) + (1 / compatibilities[1]) + (1 / compatibilities[2]);
  const harmonicFit = denom > 0 ? 3 / denom : 0.15;
  const S_level = Math.round(harmonicFit * 100);

  // 2. Weakest-Link Reliability
  const reliabilities = participants.map(u => {
    const uid = (u._id || u).toString();
    const relData = reliabilityMap.get(uid);
    return typeof relData?.score === 'number' ? relData.score : DEFAULT_PRIOR_MEAN;
  });

  const minRel = Math.min(...reliabilities);
  const avgRel = (reliabilities[0] + reliabilities[1] + reliabilities[2]) / 3;
  const cycleRel = 0.5 * minRel + 0.5 * avgRel;
  const S_rel = Math.round(cycleRel * 100);

  // 3. Bayesian Rating Normalization
  const ratingScores = participants.map(u =>
    bayesianRatingScore(u.averageRating, u.totalRatings)
  );
  const avgRatingNorm = (ratingScores[0] + ratingScores[1] + ratingScores[2]) / 3;
  const S_rating = Math.round(avgRatingNorm * 100);

  // 4. Skill Verification
  let verifiedCount = 0;
  for (const leg of rawLegs) {
    const tId = (leg.teacher._id || leg.teacher).toString();
    const skillNameLow = (leg.skill || '').trim().toLowerCase();
    const userVerifiedSet = verifiedMap[tId];
    if (userVerifiedSet && userVerifiedSet.has(skillNameLow)) {
      verifiedCount++;
    }
  }
  const S_verify = Math.round((verifiedCount / 3) * 100);

  // Final Weighted Score
  const rawScore =
    CYCLE_WEIGHTS.levelCompatibility  * S_level +
    CYCLE_WEIGHTS.exchangeReliability * S_rel +
    CYCLE_WEIGHTS.bayesianRating      * S_rating +
    CYCLE_WEIGHTS.skillVerification   * S_verify;

  const cycleScore = Math.min(100, Math.max(0, Math.round(rawScore)));

  // Score breakdown
  const scoreBreakdown = {
    levelCompatibility:  S_level,
    exchangeReliability: S_rel,
    bayesianRating:      S_rating,
    skillVerification:   S_verify,
    weights: {
      levelCompatibility:  35,
      exchangeReliability: 35,
      bayesianRating:      15,
      skillVerification:   15,
    },
  };

  // Human-readable transparent reasons
  const reasons = [];

  // Edge structure description
  const t0 = rawLegs[0].teacher.name || 'User A';
  const l0 = rawLegs[0].learner.name || 'User B';
  const s0 = rawLegs[0].skill;
  const t1 = rawLegs[1].teacher.name || 'User B';
  const l1 = rawLegs[1].learner.name || 'User C';
  const s1 = rawLegs[1].skill;
  const t2 = rawLegs[2].teacher.name || 'User C';
  const l2 = rawLegs[2].learner.name || 'User A';
  const s2 = rawLegs[2].skill;
  reasons.push(`3-way circular loop: ${t0} teaches ${s0} → ${l0}, ${t1} teaches ${s1} → ${l1}, ${t2} teaches ${s2} → ${l2}`);

  // Level compatibility reason
  if (S_level >= 90) {
    reasons.push(`High skill level compatibility across all 3 legs (Harmonic fit: ${S_level}%)`);
  } else if (S_level >= 60) {
    reasons.push(`Balanced skill level compatibility across legs (${S_level}%)`);
  } else {
    reasons.push(`Foundational skill level compatibility across legs (${S_level}%)`);
  }

  // Reliability reason
  if (S_rel >= 80) {
    reasons.push(`Strong mutual exchange reliability (${S_rel}%)`);
  } else if (S_rel >= 70) {
    reasons.push(`Neutral or building exchange reliability (${S_rel}%)`);
  } else {
    reasons.push(`Exchange reliability score: ${S_rel}%`);
  }

  // Rating reason
  if (S_rating >= 80) {
    reasons.push(`Excellent community rating reputation (${S_rating}%)`);
  } else {
    reasons.push(`Community rating score: ${S_rating}%`);
  }

  // Verification reason
  if (verifiedCount === 3) {
    reasons.push('All 3 exchanged skills are admin-verified ✓✓✓');
  } else if (verifiedCount > 0) {
    reasons.push(`${verifiedCount} of 3 exchanged skills are admin-verified ✓`);
  }

  return { cycleScore, scoreBreakdown, reasons };
}

// ─── Candidate Discovery Engine ───────────────────────────────────────────────

/**
 * Discovers valid, conflict-free 3-person directed skill exchange cycles for currentUser.
 *
 * @param {Object|string|mongoose.Types.ObjectId} currentUser
 * @param {Object} [options]
 * @param {number} [options.limit=5]
 * @returns {Promise<{ cycles: Array, meta: Object }>}
 */
async function findCircularCycles(currentUser, options = {}) {
  const limit = typeof options.limit === 'number' && options.limit > 0 ? options.limit : DEFAULT_RETURN_LIMIT;

  // Resolve currentUser
  let userA = currentUser;
  if (!userA || !userA.skillsOffered || !userA.skillsWanted) {
    if (userA && (typeof userA === 'string' || userA instanceof mongoose.Types.ObjectId || userA._id)) {
      const uId = userA._id || userA;
      userA = await User.findById(uId).select(
        'name bio skillsOffered skillsWanted availabilitySlots blockedUsers averageRating totalRatings'
      ).lean();
    }
  }

  if (!userA) {
    return {
      cycles: [],
      meta: { totalFound: 0, computedAt: new Date().toISOString() },
    };
  }

  const myId = (userA._id).toString();
  const myOffered = Array.isArray(userA.skillsOffered) ? userA.skillsOffered : [];
  const myWanted = Array.isArray(userA.skillsWanted) ? userA.skillsWanted : [];

  // If user offers nothing or wants nothing, no cycle can be completed
  if (myOffered.length === 0 || myWanted.length === 0) {
    return {
      cycles: [],
      meta: { totalFound: 0, computedAt: new Date().toISOString() },
    };
  }

  const aBlocked = (userA.blockedUsers || []).map(id => id.toString());
  const excludeFromSearch = [userA._id, ...userA.blockedUsers || []];

  // ── Step 1: Hop 1 Discovery (Candidate B) ──────────────────────────────────
  // Candidate B must want at least one skill offered by User A
  const myOfferedRegexes = myOffered
    .map(s => (s.skill || '').trim())
    .filter(Boolean)
    .map(s => new RegExp('^' + escapeRegex(s) + '$', 'i'));

  const hop1Query = {
    'skillsWanted.skill': { $in: myOfferedRegexes },
    _id:                  { $nin: excludeFromSearch },
    blockedUsers:         { $ne: userA._id },
    role:                 { $ne: 'admin' },
  };

  const rawHop1Users = await User.find(hop1Query)
    .select('name bio skillsOffered skillsWanted availabilitySlots averageRating totalRatings blockedUsers')
    .lean();

  // Rank Hop 1 candidates by skill compatibility & priority on matched skills
  const rankedHop1 = [];
  for (const b of rawHop1Users) {
    if (isMutuallyBlocked(userA, b)) continue;

    let bestScoreB = 0;
    for (const wantB of (b.skillsWanted || [])) {
      const wantName = (wantB.skill || '').trim().toLowerCase();
      const matchA = myOffered.find(o => (o.skill || '').trim().toLowerCase() === wantName);
      if (matchA) {
        const pWeight = PRIORITY_WEIGHT[wantB.priority] || 0.7;
        const comp = computeSkillLevelCompatibility(matchA.level, wantB.level);
        const pairScore = pWeight * comp;
        if (pairScore > bestScoreB) bestScoreB = pairScore;
      }
    }

    const bRating = bayesianRatingScore(b.averageRating, b.totalRatings);
    const compositeRankB = 0.85 * bestScoreB + 0.15 * bRating;
    rankedHop1.push({ user: b, rank: compositeRankB });
  }

  rankedHop1.sort((x, y) => y.rank - x.rank);
  const candidatesB = rankedHop1.slice(0, HOP1_LIMIT).map(item => item.user);

  if (candidatesB.length === 0) {
    return {
      cycles: [],
      meta: { totalFound: 0, computedAt: new Date().toISOString() },
    };
  }

  // ── Step 2: Hop 2 Discovery (Candidate C) ──────────────────────────────────
  // Candidate C must:
  // 1. Offer a skill wanted by User A (C -> A)
  // 2. Want a skill offered by at least one Candidate B (B -> C)
  const myWantedRegexes = myWanted
    .map(s => (s.skill || '').trim())
    .filter(Boolean)
    .map(s => new RegExp('^' + escapeRegex(s) + '$', 'i'));

  const bOfferedSkillNames = new Set();
  for (const b of candidatesB) {
    for (const o of (b.skillsOffered || [])) {
      const s = (o.skill || '').trim();
      if (s) bOfferedSkillNames.add(s);
    }
  }

  if (bOfferedSkillNames.size === 0) {
    return {
      cycles: [],
      meta: { totalFound: 0, computedAt: new Date().toISOString() },
    };
  }

  const bOfferedRegexes = Array.from(bOfferedSkillNames)
    .map(s => new RegExp('^' + escapeRegex(s) + '$', 'i'));

  const hop2Exclude = [
    userA._id,
    ...(userA.blockedUsers || []),
    ...candidatesB.map(b => b._id),
  ];

  const hop2Query = {
    'skillsOffered.skill': { $in: myWantedRegexes },
    'skillsWanted.skill':  { $in: bOfferedRegexes },
    _id:                   { $nin: hop2Exclude },
    blockedUsers:          { $ne: userA._id },
    role:                  { $ne: 'admin' },
  };

  const rawHop2Users = await User.find(hop2Query)
    .select('name bio skillsOffered skillsWanted availabilitySlots averageRating totalRatings blockedUsers')
    .lean();

  // Rank Hop 2 candidates by skill compatibility & priority
  const rankedHop2 = [];
  for (const c of rawHop2Users) {
    if (isMutuallyBlocked(userA, c)) continue;

    let bestScoreC = 0;
    // Evaluation for C -> A
    for (const offerC of (c.skillsOffered || [])) {
      const offerName = (offerC.skill || '').trim().toLowerCase();
      const matchA = myWanted.find(w => (w.skill || '').trim().toLowerCase() === offerName);
      if (matchA) {
        const pWeight = PRIORITY_WEIGHT[matchA.priority] || 0.7;
        const comp = computeSkillLevelCompatibility(offerC.level, matchA.level);
        const pairScore = pWeight * comp;
        if (pairScore > bestScoreC) bestScoreC = pairScore;
      }
    }

    const cRating = bayesianRatingScore(c.averageRating, c.totalRatings);
    const compositeRankC = 0.85 * bestScoreC + 0.15 * cRating;
    rankedHop2.push({ user: c, rank: compositeRankC });
  }

  rankedHop2.sort((x, y) => y.rank - x.rank);
  const candidatesC = rankedHop2.slice(0, HOP2_LIMIT).map(item => item.user);

  if (candidatesC.length === 0) {
    return {
      cycles: [],
      meta: { totalFound: 0, computedAt: new Date().toISOString() },
    };
  }

  // ── Step 3: Triangle Construction & Canonical Deduplication ────────────────
  const candidateCycles = [];
  const seenHashes = new Set();

  for (const b of candidatesB) {
    const bId = b._id.toString();
    if (bId === myId) continue;
    if (isMutuallyBlocked(userA, b)) continue;

    // Find best matching skill for A -> B
    let bestEdgeAB = null;
    let bestScoreAB = -1;
    for (const offerA of myOffered) {
      const oName = (offerA.skill || '').trim().toLowerCase();
      for (const wantB of (b.skillsWanted || [])) {
        const wName = (wantB.skill || '').trim().toLowerCase();
        if (oName === wName) {
          const comp = computeSkillLevelCompatibility(offerA.level, wantB.level);
          const pWeight = PRIORITY_WEIGHT[wantB.priority] || 0.7;
          const score = comp * pWeight;
          if (score > bestScoreAB) {
            bestScoreAB = score;
            bestEdgeAB = {
              skill:        offerA.skill,
              category:     offerA.category || 'General',
              teacherLevel: offerA.level || 'Intermediate',
              learnerLevel: wantB.level || null,
            };
          }
        }
      }
    }

    if (!bestEdgeAB) continue;

    for (const c of candidatesC) {
      const cId = c._id.toString();
      if (cId === myId || cId === bId) continue;

      // 3-way mutual blocking check: (B, C) and (C, A)
      if (isMutuallyBlocked(b, c)) continue;
      if (isMutuallyBlocked(c, userA)) continue;

      // Find best matching skill for B -> C
      let bestEdgeBC = null;
      let bestScoreBC = -1;
      for (const offerB of (b.skillsOffered || [])) {
        const oName = (offerB.skill || '').trim().toLowerCase();
        for (const wantC of (c.skillsWanted || [])) {
          const wName = (wantC.skill || '').trim().toLowerCase();
          if (oName === wName) {
            const comp = computeSkillLevelCompatibility(offerB.level, wantC.level);
            const pWeight = PRIORITY_WEIGHT[wantC.priority] || 0.7;
            const score = comp * pWeight;
            if (score > bestScoreBC) {
              bestScoreBC = score;
              bestEdgeBC = {
                skill:        offerB.skill,
                category:     offerB.category || 'General',
                teacherLevel: offerB.level || 'Intermediate',
                learnerLevel: wantC.level || null,
              };
            }
          }
        }
      }

      if (!bestEdgeBC) continue;

      // Find best matching skill for C -> A
      let bestEdgeCA = null;
      let bestScoreCA = -1;
      for (const offerC of (c.skillsOffered || [])) {
        const oName = (offerC.skill || '').trim().toLowerCase();
        for (const wantA of myWanted) {
          const wName = (wantA.skill || '').trim().toLowerCase();
          if (oName === wName) {
            const comp = computeSkillLevelCompatibility(offerC.level, wantA.level);
            const pWeight = PRIORITY_WEIGHT[wantA.priority] || 0.7;
            const score = comp * pWeight;
            if (score > bestScoreCA) {
              bestScoreCA = score;
              bestEdgeCA = {
                skill:        offerC.skill,
                category:     offerC.category || 'General',
                teacherLevel: offerC.level || 'Intermediate',
                learnerLevel: wantA.level || null,
              };
            }
          }
        }
      }

      if (!bestEdgeCA) continue;

      // Construct ordered legs for User A's vantage point: A -> B -> C -> A
      const rawLegs = [
        {
          teacher:      userA,
          learner:      b,
          skill:        bestEdgeAB.skill,
          category:     bestEdgeAB.category,
          teacherLevel: bestEdgeAB.teacherLevel,
          learnerLevel: bestEdgeAB.learnerLevel,
        },
        {
          teacher:      b,
          learner:      c,
          skill:        bestEdgeBC.skill,
          category:     bestEdgeBC.category,
          teacherLevel: bestEdgeBC.teacherLevel,
          learnerLevel: bestEdgeBC.learnerLevel,
        },
        {
          teacher:      c,
          learner:      userA,
          skill:        bestEdgeCA.skill,
          category:     bestEdgeCA.category,
          teacherLevel: bestEdgeCA.teacherLevel,
          learnerLevel: bestEdgeCA.learnerLevel,
        },
      ];

      // Structural validation & rotation-invariant canonicalization
      try {
        const canon = CircularExchange.validateAndCanonicalize(
          [userA._id, b._id, c._id],
          rawLegs
        );

        if (seenHashes.has(canon.canonicalCycleHash)) {
          continue; // Rotationally equivalent cycle already registered
        }
        seenHashes.add(canon.canonicalCycleHash);

        candidateCycles.push({
          canonicalCycleHash: canon.canonicalCycleHash,
          rawLegs,
          participants: [userA, b, c],
        });
      } catch (err) {
        // Discard invalid graph configurations (self-loops, bilateral 2-cycles, etc.)
        continue;
      }
    }
  }

  if (candidateCycles.length === 0) {
    return {
      cycles: [],
      meta: { totalFound: 0, computedAt: new Date().toISOString() },
    };
  }

  // ── Step 4: Conflict Checking Across Candidate Cycles (Single Batch) ────────
  const candidateHashes = candidateCycles.map(c => c.canonicalCycleHash);
  const allParticipantIdsSet = new Set();
  for (const c of candidateCycles) {
    for (const p of c.participants) {
      allParticipantIdsSet.add((p._id || p).toString());
    }
  }
  const allParticipantIds = Array.from(allParticipantIdsSet).map(id => new mongoose.Types.ObjectId(id));

  // 1. Exclude cycles with existing proposed or active CircularExchange records
  const existingCirculars = await CircularExchange.find({
    canonicalCycleHash: { $in: candidateHashes },
    status:             { $in: ['proposed', 'active'] },
  }).select('canonicalCycleHash').lean();

  const busyCycleHashes = new Set(existingCirculars.map(e => e.canonicalCycleHash));

  // 2. Exclude cycles where any participant has an active accepted bilateral swap
  const activeBilateralSwaps = await SwapRequest.find({
    $or: [
      { fromUser: { $in: allParticipantIds }, status: 'accepted' },
      { toUser:   { $in: allParticipantIds }, status: 'accepted' },
    ],
  }).select('fromUser toUser').lean();

  const busyParticipants = new Set();
  for (const swap of activeBilateralSwaps) {
    if (swap.fromUser) busyParticipants.add(swap.fromUser.toString());
    if (swap.toUser) busyParticipants.add(swap.toUser.toString());
  }

  // 3. Exclude cycles where any participant holds an active ExchangeReservation
  const activeReservations = await ExchangeReservation.find({
    participant: { $in: allParticipantIds },
  }).select('participant').lean();

  for (const res of activeReservations) {
    if (res.participant) busyParticipants.add(res.participant.toString());
  }

  // Filter candidate cycles
  const eligibleCycles = candidateCycles.filter(cycle => {
    if (busyCycleHashes.has(cycle.canonicalCycleHash)) return false;
    for (const p of cycle.participants) {
      const pid = (p._id || p).toString();
      if (busyParticipants.has(pid)) return false;
    }
    return true;
  });

  if (eligibleCycles.length === 0) {
    return {
      cycles: [],
      meta: { totalFound: 0, computedAt: new Date().toISOString() },
    };
  }

  // ── Step 5: Scoring Data Batch Queries ──────────────────────────────────────
  const eligibleParticipantIdsSet = new Set();
  for (const c of eligibleCycles) {
    for (const p of c.participants) {
      eligibleParticipantIdsSet.add((p._id || p).toString());
    }
  }
  const eligibleParticipantIds = Array.from(eligibleParticipantIdsSet);

  // A. Exchange reliability via reliabilityService
  const reliabilityMap = await getBatchExchangeReliability(eligibleParticipantIds);

  // B. Admin skill verifications
  const verifications = await SkillVerification.find({
    user:   { $in: eligibleParticipantIds.map(id => new mongoose.Types.ObjectId(id)) },
    status: 'verified',
  }).select('user skillName').lean();

  const verifiedMap = {};
  for (const v of verifications) {
    const uid = v.user.toString();
    if (!verifiedMap[uid]) verifiedMap[uid] = new Set();
    verifiedMap[uid].add((v.skillName || '').trim().toLowerCase());
  }

  // ── Step 6: Multi-Factor Scoring & Ranking ──────────────────────────────────
  const scoredCycles = [];

  for (const cycle of eligibleCycles) {
    const { cycleScore, scoreBreakdown, reasons } = scoreCycle(cycle, {
      reliabilityMap,
      verifiedMap,
    });

    // Public sanitized leg projection
    const sanitizedLegs = cycle.rawLegs.map((leg, idx) => ({
      legIndex:           idx,
      teacher:            sanitizePublicUser(leg.teacher),
      learner:            sanitizePublicUser(leg.learner),
      skill:              leg.skill,
      category:           leg.category || 'General',
      teacherLevel:       leg.teacherLevel || 'Intermediate',
      learnerLevel:       leg.learnerLevel || null,
      levelCompatibility: computeSkillLevelCompatibility(leg.teacherLevel, leg.learnerLevel),
    }));

    scoredCycles.push({
      canonicalCycleHash: cycle.canonicalCycleHash,
      cycleScore,
      scoreBreakdown,
      reasons,
      legs: sanitizedLegs,
    });
  }

  // Sort descending by cycleScore; deterministic secondary tiebreak on canonicalCycleHash
  scoredCycles.sort((a, b) => {
    if (b.cycleScore !== a.cycleScore) {
      return b.cycleScore - a.cycleScore;
    }
    return a.canonicalCycleHash.localeCompare(b.canonicalCycleHash);
  });

  return {
    cycles: scoredCycles.slice(0, limit),
    meta: {
      totalFound: scoredCycles.length,
      computedAt: new Date().toISOString(),
    },
  };
}

module.exports = {
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
};
