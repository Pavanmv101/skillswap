/**
 * Phase 5 — Intelligent Recommendation Engine
 * controllers/recommendationController.js
 *
 * All scoring is rule-based, fully transparent, and computed server-side only.
 * No ML, no paid APIs, no external services.
 *
 * Scoring weights (sum = 100):
 *   Forward match   35 pts  (they offer what I want, priority-weighted)
 *   Reverse match   25 pts  (I offer what they want, priority-weighted)
 *   Verification    15 pts  (admin-approved SkillVerification records only)
 *   Rating          10 pts  (confidence-aware Bayesian adjustment)
 *   Endorsements     8 pts  (peer endorsements on matched skills)
 *   Availability     5 pts  (overlapping time-slots)
 *   Category         2 pts  (category affinity of matched skills)
 *   ─────────────────────────
 *   Total          100 pts
 *
 * Learning history is intentionally excluded from the scoring formula
 * in Phase 5 MVP. It is reserved for future skill-suggestion improvements.
 */

'use strict';

const User             = require('../models/User');
const SwapRequest      = require('../models/SwapRequest');
const Endorsement      = require('../models/Endorsement');
const Rating           = require('../models/Rating');
const SkillVerification = require('../models/SkillVerification');

// ─── Constants ────────────────────────────────────────────────────────────────

const WEIGHTS = {
  forward:      35,
  reverse:      25,
  verification: 15,
  rating:       10,
  endorsement:   8,
  availability:  5,
  category:      2,
};

// Confidence-aware rating: global prior (mean rating on the platform = 3.5, weight = 5 pseudo-ratings)
const PRIOR_RATING    = 3.5;
const PRIOR_WEIGHT    = 5;

// Priority multipliers for skillsWanted entries
const PRIORITY_WEIGHT = { High: 1.0, Medium: 0.7, Low: 0.4 };

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
}) {
  const reasons = [];

  if (forwardMatched.length > 0) {
    const verified = forwardMatched.filter(s => verifiedMatchedSkills.includes(s.toLowerCase()));
    const plain    = forwardMatched.filter(s => !verifiedMatchedSkills.includes(s.toLowerCase()));
    if (verified.length > 0)
      reasons.push(`Teaches ${verified.map(s => `${s} ✓`).join(', ')} (admin-verified) — skills you want`);
    if (plain.length > 0)
      reasons.push(`Offers ${plain.join(', ')} — matching your learning goals`);
  }

  if (reverseMatched.length > 0) {
    reasons.push(`Wants ${reverseMatched.join(', ')} — skills you can teach`);
  }

  if (totalRatings >= 3) {
    const display = (bayesianRating * 4 + 1).toFixed(1); // reverse-normalise for display
    reasons.push(`⭐ Rated ${display}/5 across ${totalRatings} sessions`);
  } else if (totalRatings > 0) {
    reasons.push(`⭐ ${totalRatings} session rating(s) so far`);
  }

  if (endorsementCount > 0) {
    reasons.push(`${endorsementCount} peer endorsement${endorsementCount > 1 ? 's' : ''} on matched skills`);
  }

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

  // Admin-verified SkillVerification records for matched candidates
  const verifications = await SkillVerification.find({
    user:   { $in: candidateIds },
    status: 'verified',
  }).select('user skillName');

  // Group verifications by userId → Set of verified skill names (lowercase)
  const verifiedMap = {};
  for (const v of verifications) {
    const uid = v.user.toString();
    if (!verifiedMap[uid]) verifiedMap[uid] = new Set();
    verifiedMap[uid].add(v.skillName.trim().toLowerCase());
  }

  // Endorsements on candidates received from any user (scoped to matched skills)
  const endorsements = await Endorsement.find({
    recipient: { $in: candidateIds },
  }).select('recipient skillName');

  // Group endorsements: uid → { skillLow: count }
  const endorseMap = {};
  for (const e of endorsements) {
    const uid = e.recipient.toString();
    if (!endorseMap[uid]) endorseMap[uid] = {};
    const skill = e.skillName.trim().toLowerCase();
    endorseMap[uid][skill] = (endorseMap[uid][skill] || 0) + 1;
  }

  // ── 4. Score each candidate ────────────────────────────────────────────────
  const scored = [];

  for (const candidate of candidates) {
    const cid          = candidate._id.toString();
    const theirOfferedLow = skillNames(candidate.skillsOffered);
    const theirWanted     = candidate.skillsWanted || [];

    // Forward match
    const fwd = forwardMatchScore(myWanted, theirOfferedLow);

    // Reverse match
    const rev = reverseMatchScore(theirWanted, myOfferedLow);

    // Skip candidates with zero signal in both directions
    if (fwd.score === 0 && rev.score === 0) continue;

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

    // Category affinity
    const catScore = categoryAffinityScore(myWanted, candidate.skillsOffered, fwd.matched);

    // ── Final weighted score (0–100) ─────────────────────────────────────────
    const finalScore = Math.round(
      fwd.score        * WEIGHTS.forward      +
      rev.score        * WEIGHTS.reverse      +
      verifyScore      * WEIGHTS.verification +
      ratingScore      * WEIGHTS.rating       +
      endorseScore     * WEIGHTS.endorsement  +
      availScore       * WEIGHTS.availability +
      catScore         * WEIGHTS.category
    );

    // ── Reason strings ────────────────────────────────────────────────────────
    const reasons = buildReasons({
      forwardMatched:       fwd.matched,
      reverseMatched:       rev.matched,
      verifiedMatchedSkills: [...verifiedSet],
      bayesianRating:       ratingScore,
      totalRatings:         candidate.totalRatings || 0,
      endorsementCount:     endorseCount,
      availOverlap,
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
        forwardMatch:     Math.round(fwd.score        * WEIGHTS.forward),
        reverseMatch:     Math.round(rev.score        * WEIGHTS.reverse),
        verificationBoost:Math.round(verifyScore      * WEIGHTS.verification),
        ratingScore:      Math.round(ratingScore      * WEIGHTS.rating),
        endorsementScore: Math.round(endorseScore     * WEIGHTS.endorsement),
        availabilityScore:Math.round(availScore       * WEIGHTS.availability),
        categoryScore:    Math.round(catScore         * WEIGHTS.category),
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
