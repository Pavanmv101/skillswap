/**
 * Phase 6 — Advanced Skill Exchange Algorithm
 * services/reliabilityService.js
 *
 * Core service for computing exchange reliability and completion metrics.
 * Uses a Bayesian-smoothed model to guarantee fairness for new users while
 * accurately capturing historical completion reliability for experienced peers.
 *
 * Mathematical Model:
 *   Reliability Score = (C + K * P0) / (C + F + K)
 *
 * Where:
 *   C  = Completed exchanges (successful mutual outcomes)
 *   F  = Explicitly failed or attributed abandoned exchanges
 *   K  = Prior weight (default 3.0 pseudo-exchanges)
 *   P0 = Neutral prior mean (default 0.70, provisional design heuristic)
 *
 * Attribution Rules & Lifecycle Semantics:
 *   1. Completed exchanges (status: 'completed') represent mutual success (C += 1).
 *   2. Pending requests, rejected proposals, and pre-acceptance cancellations
 *      are NOT exchanges and are strictly excluded from completion scoring.
 *   3. Active accepted exchanges currently within normal completion windows
 *      are treated as ongoing in-flight sessions (activeCount).
 *   4. Stale accepted exchanges where scheduled time has passed or activity has
 *      stalled are classified as unattributed/neutral (unattributedCount). Because
 *      the existing schema lacks fault attribution (e.g. who abandoned the call),
 *      stale swaps are NOT penalized against either user's score (F is unchanged).
 *   5. Malformed/invalid schedule dates are classified as unattributed/neutral
 *      rather than silently remaining active or blaming either participant.
 */

'use strict';

const mongoose    = require('mongoose');
const SwapRequest = require('../models/SwapRequest');

/**
 * Default Bayesian Prior Constants:
 *
 * DEFAULT_PRIOR_MEAN = 0.70:
 *   PROVISIONAL DESIGN HEURISTIC: This 0.70 baseline was selected to align with
 *   the platform's neutral rating expectation (3.5 / 5.0 = 0.70). It is NOT an
 *   empirically measured platform completion rate. Once long-term production
 *   telemetry is collected, this prior can be calibrated against observed base rates.
 *
 * DEFAULT_PRIOR_WEIGHT = 3.0:
 *   Confidence weight equivalent to 3 neutral exchange observations.
 *
 * DEFAULT_STALE_DAYS = 14:
 *   Grace period (days) past a scheduled session before an uncompleted accepted
 *   swap is classified as stale.
 */
const DEFAULT_PRIOR_MEAN   = 0.70;
const DEFAULT_PRIOR_WEIGHT = 3.0;
const DEFAULT_STALE_DAYS   = 14;

/**
 * Pure mathematical calculation of Bayesian exchange reliability.
 * Safe against division by zero, NaN, and negative inputs.
 *
 * @param {number} completed - Count of successfully completed exchanges (C >= 0)
 * @param {number} failed    - Count of explicitly failed / attributed exchanges (F >= 0)
 * @param {Object} [options]
 * @param {number} [options.priorMean=0.70]   - Neutral prior (0..1)
 * @param {number} [options.priorWeight=3.0]  - Prior confidence weight (K > 0)
 * @returns {number} Normalized reliability score strictly between 0 and 1
 */
function calculateBayesianReliability(completed = 0, failed = 0, options = {}) {
  const c = Math.max(0, Number(completed) || 0);
  const f = Math.max(0, Number(failed) || 0);

  const p0 = typeof options.priorMean === 'number' && !isNaN(options.priorMean)
    ? Math.min(1, Math.max(0, options.priorMean))
    : DEFAULT_PRIOR_MEAN;

  const k = typeof options.priorWeight === 'number' && !isNaN(options.priorWeight) && options.priorWeight > 0
    ? options.priorWeight
    : DEFAULT_PRIOR_WEIGHT;

  const numerator   = c + (k * p0);
  const denominator = c + f + k;

  if (denominator <= 0) return p0;
  if (c === 0 && f === 0) return p0;

  const score = numerator / denominator;
  // Round to 4 decimal places to prevent floating-point artifacts
  const rounded = Math.round(score * 10000) / 10000;
  return Math.min(1, Math.max(0, rounded));
}

/**
 * Classifies an accepted swap as either currently active or stale/unattributed.
 * Handles valid future dates, valid past dates, missing dates, and malformed dates.
 *
 * @param {Object} swap - SwapRequest document
 * @param {number} [staleDays=DEFAULT_STALE_DAYS] - Days threshold
 * @param {Date}   [now=new Date()]
 * @returns {'active'|'unattributed'}
 */
function classifyAcceptedSwap(swap, staleDays = DEFAULT_STALE_DAYS, now = new Date()) {
  const nowMs = now.getTime();
  const thresholdMs = staleDays * 24 * 60 * 60 * 1000;

  // Check if scheduledAt is provided
  if (swap && swap.scheduledAt !== null && swap.scheduledAt !== undefined && swap.scheduledAt !== '') {
    const scheduledDate = new Date(swap.scheduledAt);
    const scheduledMs = scheduledDate.getTime();

    // Invalid scheduledAt date string -> classify as unattributed/neutral
    if (isNaN(scheduledMs)) {
      return 'unattributed';
    }

    // Scheduled in the future -> active in-flight session
    if (scheduledMs > nowMs) {
      return 'active';
    }

    // Scheduled in past beyond stale threshold -> stale unattributed
    if (nowMs - scheduledMs > thresholdMs) {
      return 'unattributed';
    }

    // Recently passed scheduled session (within staleDays) -> still considered in-flight
    return 'active';
  }

  // If no scheduled date was set, examine updatedAt / createdAt
  const updatedDate = new Date(swap?.updatedAt || swap?.createdAt);
  const updatedMs = updatedDate.getTime();

  // If timestamps are malformed -> classify as unattributed
  if (isNaN(updatedMs)) {
    return 'unattributed';
  }

  const maxUnscheduledDays = staleDays * 2; // e.g. 28 days grace period for unscheduled accepted swaps
  if (nowMs - updatedMs > (maxUnscheduledDays * 24 * 60 * 60 * 1000)) {
    return 'unattributed';
  }

  return 'active';
}

/**
 * Pure helper to aggregate swap documents for a single participant into
 * metrics and compute their Bayesian reliability score without extra database calls.
 *
 * @param {Array<Object>} swaps - Array of SwapRequest objects for this participant
 * @param {Object} [options]
 * @returns {Object} Reliability breakdown
 */
function processUserSwaps(swaps = [], options = {}) {
  const fallback = {
    score: options.priorMean ?? DEFAULT_PRIOR_MEAN,
    completedCount: 0,
    failedCount: 0,
    activeCount: 0,
    unattributedCount: 0,
    neutralPrior: true,
    metrics: {
      totalExchanges: 0,
      rawCompletionRate: null,
      pendingCount: 0,
      rejectedCount: 0,
      cancelledCount: 0,
      unattributedCount: 0,
    },
  };

  if (!Array.isArray(swaps) || swaps.length === 0) {
    return fallback;
  }

  const now = options.now instanceof Date ? options.now : new Date();
  const staleDays = options.staleDays ?? DEFAULT_STALE_DAYS;

  let completedCount    = 0;
  let failedCount       = 0;
  let activeCount       = 0;
  let unattributedCount = 0;
  let pendingCount      = 0;
  let rejectedCount     = 0;
  let cancelledCount    = 0;

  for (const swap of swaps) {
    const status = swap.status;

    if (status === 'completed') {
      // Both participants successfully concluded the exchange
      completedCount++;
    } else if (status === 'accepted') {
      const state = classifyAcceptedSwap(swap, staleDays, now);
      if (state === 'unattributed') {
        // Fair attribution: without explicit fault logging, stale swaps are neutral
        unattributedCount++;
      } else {
        // In-flight active session
        activeCount++;
      }
    } else if (status === 'pending') {
      // Proposal awaiting review — neither completed nor failed
      pendingCount++;
    } else if (status === 'rejected') {
      // Proposal declined before acceptance — never an exchange
      rejectedCount++;
    } else if (status === 'cancelled') {
      // Pre-acceptance withdrawal by sender — never an exchange
      cancelledCount++;
    }
  }

  // Concluded exchanges with explicit completion or failure attribution
  const concludedCount = completedCount + failedCount;
  const neutralPrior   = concludedCount === 0;

  const score = calculateBayesianReliability(completedCount, failedCount, options);

  const rawCompletionRate = concludedCount > 0
    ? Math.round((completedCount / concludedCount) * 100) / 100
    : null;

  return {
    score,
    completedCount,
    failedCount,
    activeCount,
    unattributedCount,
    neutralPrior,
    metrics: {
      totalExchanges: completedCount + failedCount + activeCount + unattributedCount,
      rawCompletionRate,
      pendingCount,
      rejectedCount,
      cancelledCount,
      unattributedCount,
    },
  };
}

/**
 * Aggregates all swap requests for a single user and calculates their complete
 * exchange reliability profile.
 *
 * @param {string|mongoose.Types.ObjectId} userId
 * @param {Object} [options]
 * @returns {Promise<Object>} Reliability breakdown and metrics
 */
async function getUserExchangeReliability(userId, options = {}) {
  const fallback = {
    score: options.priorMean ?? DEFAULT_PRIOR_MEAN,
    completedCount: 0,
    failedCount: 0,
    activeCount: 0,
    unattributedCount: 0,
    neutralPrior: true,
    metrics: {
      totalExchanges: 0,
      rawCompletionRate: null,
      pendingCount: 0,
      rejectedCount: 0,
      cancelledCount: 0,
      unattributedCount: 0,
    },
  };

  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
    return fallback;
  }

  const userObjId = new mongoose.Types.ObjectId(userId);

  // Single query for this user's swaps
  const swaps = await SwapRequest.find({
    $or: [{ fromUser: userObjId }, { toUser: userObjId }],
  }).select('fromUser toUser status scheduledAt createdAt updatedAt');

  return processUserSwaps(swaps, options);
}

/**
 * Batch-calculates exchange reliability for multiple candidate user IDs.
 * ELIMINATES N+1: Executes EXACTLY ONE database query using $or with $in,
 * then groups documents in memory by user ID.
 *
 * @param {Array<string|mongoose.Types.ObjectId>} userIds
 * @param {Object} [options]
 * @returns {Promise<Map<string, Object>>} Map of userIdString -> reliabilityResult
 */
async function getBatchExchangeReliability(userIds = [], options = {}) {
  const resultsMap = new Map();
  if (!Array.isArray(userIds) || userIds.length === 0) {
    return resultsMap;
  }

  // Deduplicate and validate ObjectIds
  const validObjIds = [];
  const uniqueIdStrings = [];
  const seen = new Set();

  for (const rawId of userIds) {
    if (rawId && mongoose.Types.ObjectId.isValid(rawId)) {
      const idStr = rawId.toString();
      if (!seen.has(idStr)) {
        seen.add(idStr);
        uniqueIdStrings.push(idStr);
        validObjIds.push(new mongoose.Types.ObjectId(idStr));
      }
    }
  }

  if (uniqueIdStrings.length === 0) {
    return resultsMap;
  }

  // EXACTLY ONE batched query to fetch all relevant swaps for candidate set
  const allSwaps = await SwapRequest.find({
    $or: [
      { fromUser: { $in: validObjIds } },
      { toUser:   { $in: validObjIds } },
    ],
  }).select('fromUser toUser status scheduledAt createdAt updatedAt');

  // Group swaps in memory by participant ID
  const userSwapsMap = new Map();
  for (const idStr of uniqueIdStrings) {
    userSwapsMap.set(idStr, []);
  }

  for (const swap of allSwaps) {
    const fromStr = swap.fromUser ? swap.fromUser.toString() : null;
    const toStr   = swap.toUser   ? swap.toUser.toString()   : null;

    if (fromStr && userSwapsMap.has(fromStr)) {
      userSwapsMap.get(fromStr).push(swap);
    }
    if (toStr && toStr !== fromStr && userSwapsMap.has(toStr)) {
      userSwapsMap.get(toStr).push(swap);
    }
  }

  // Calculate each participant's reliability independently from memory
  for (const idStr of uniqueIdStrings) {
    const userSwaps = userSwapsMap.get(idStr) || [];
    const reliability = processUserSwaps(userSwaps, options);
    resultsMap.set(idStr, reliability);
  }

  return resultsMap;
}

module.exports = {
  DEFAULT_PRIOR_MEAN,
  DEFAULT_PRIOR_WEIGHT,
  DEFAULT_STALE_DAYS,
  calculateBayesianReliability,
  classifyAcceptedSwap,
  processUserSwaps,
  getUserExchangeReliability,
  getBatchExchangeReliability,
};
