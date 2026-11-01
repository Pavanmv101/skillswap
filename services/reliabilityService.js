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
 *   C  = Completed exchanges (successful outcomes)
 *   F  = Abandoned or failed accepted exchanges
 *   K  = Prior weight (default 3.0 pseudo-exchanges)
 *   P0 = Neutral prior mean (default 0.70)
 *
 * Assumptions & Cancellation Semantics:
 *   1. Pending requests, rejected proposals, and pre-acceptance cancellations
 *      are NOT exchanges and are strictly excluded from completion scoring.
 *   2. Active accepted exchanges currently within normal completion windows
 *      are treated as ongoing and are not counted as failures.
 *   3. Accepted exchanges that have stalled or been abandoned past the
 *      stale threshold are categorized as failed outcomes.
 */

'use strict';

const mongoose    = require('mongoose');
const SwapRequest = require('../models/SwapRequest');

// Default Bayesian Prior Constants
const DEFAULT_PRIOR_MEAN   = 0.70; // 70% baseline expected completion rate
const DEFAULT_PRIOR_WEIGHT = 3.0;  // equivalent to 3 neutral exchange observations
const DEFAULT_STALE_DAYS   = 14;   // days after scheduled date before an accepted swap is considered stale

/**
 * Pure mathematical calculation of Bayesian exchange reliability.
 * Safe against division by zero, NaN, and negative inputs.
 *
 * @param {number} completed - Count of successfully completed exchanges (C >= 0)
 * @param {number} failed    - Count of failed / abandoned accepted exchanges (F >= 0)
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
 * Classifies an accepted swap as either currently active or stalled/abandoned.
 *
 * @param {Object} swap - SwapRequest document
 * @param {number} staleDays - Days threshold
 * @param {Date} [now=new Date()]
 * @returns {'active'|'stalled'}
 */
function classifyAcceptedSwap(swap, staleDays = DEFAULT_STALE_DAYS, now = new Date()) {
  const nowMs = now.getTime();
  const thresholdMs = staleDays * 24 * 60 * 60 * 1000;

  // If a scheduled date exists and is in the future, it is definitely active
  if (swap.scheduledAt) {
    const scheduledMs = new Date(swap.scheduledAt).getTime();
    if (scheduledMs > nowMs) {
      return 'active';
    }
    // If scheduled date was in the past beyond staleDays, it stalled
    if (nowMs - scheduledMs > thresholdMs) {
      return 'stalled';
    }
    // Recently passed scheduled session (within threshold) still treated as in-flight
    return 'active';
  }

  // If no scheduled date was set, examine updatedAt / createdAt
  const updatedMs = new Date(swap.updatedAt || swap.createdAt).getTime();
  const maxUnscheduledDays = staleDays * 2; // e.g. 28 days for unscheduled accepted swaps
  if (nowMs - updatedMs > (maxUnscheduledDays * 24 * 60 * 60 * 1000)) {
    return 'stalled';
  }

  return 'active';
}

/**
 * Aggregates all swap requests for a user and calculates their complete
 * exchange reliability profile with participant attribution.
 *
 * @param {string|mongoose.Types.ObjectId} userId
 * @param {Object} [options]
 * @param {number} [options.priorMean=0.70]
 * @param {number} [options.priorWeight=3.0]
 * @param {number} [options.staleDays=14]
 * @param {Date}   [options.now=new Date()]
 * @returns {Promise<Object>} Reliability breakdown and metrics
 */
async function getUserExchangeReliability(userId, options = {}) {
  const fallback = {
    score: options.priorMean ?? DEFAULT_PRIOR_MEAN,
    completedCount: 0,
    failedCount: 0,
    activeCount: 0,
    neutralPrior: true,
    metrics: {
      totalExchanges: 0,
      rawCompletionRate: null,
      pendingCount: 0,
      rejectedCount: 0,
      cancelledCount: 0,
    },
  };

  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
    return fallback;
  }

  const userObjId = new mongoose.Types.ObjectId(userId);
  const now = options.now instanceof Date ? options.now : new Date();
  const staleDays = options.staleDays ?? DEFAULT_STALE_DAYS;

  // Fetch all swaps where user is either fromUser or toUser
  const swaps = await SwapRequest.find({
    $or: [{ fromUser: userObjId }, { toUser: userObjId }],
  }).select('fromUser toUser status scheduledAt createdAt updatedAt');

  if (!swaps || swaps.length === 0) {
    return fallback;
  }

  let completedCount = 0;
  let failedCount    = 0;
  let activeCount    = 0;
  let pendingCount   = 0;
  let rejectedCount  = 0;
  let cancelledCount = 0;

  for (const swap of swaps) {
    const status = swap.status;

    if (status === 'completed') {
      // Both participants successfully concluded the exchange
      completedCount++;
    } else if (status === 'accepted') {
      const state = classifyAcceptedSwap(swap, staleDays, now);
      if (state === 'stalled') {
        failedCount++;
      } else {
        activeCount++;
      }
    } else if (status === 'pending') {
      // Proposal under review — neither completed nor failed
      pendingCount++;
    } else if (status === 'rejected') {
      // Proposal declined before acceptance — never an exchange
      rejectedCount++;
    } else if (status === 'cancelled') {
      // Pre-acceptance withdrawal by sender — never an exchange
      cancelledCount++;
    }
  }

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
    neutralPrior,
    metrics: {
      totalExchanges: concludedCount + activeCount,
      rawCompletionRate,
      pendingCount,
      rejectedCount,
      cancelledCount,
    },
  };
}

/**
 * Batch-calculates exchange reliability for multiple candidate user IDs in parallel.
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

  const validIds = userIds
    .filter(id => id && mongoose.Types.ObjectId.isValid(id))
    .map(id => id.toString());

  const uniqueIds = [...new Set(validIds)];

  await Promise.all(
    uniqueIds.map(async (uid) => {
      const result = await getUserExchangeReliability(uid, options);
      resultsMap.set(uid, result);
    })
  );

  return resultsMap;
}

module.exports = {
  DEFAULT_PRIOR_MEAN,
  DEFAULT_PRIOR_WEIGHT,
  DEFAULT_STALE_DAYS,
  calculateBayesianReliability,
  classifyAcceptedSwap,
  getUserExchangeReliability,
  getBatchExchangeReliability,
};
