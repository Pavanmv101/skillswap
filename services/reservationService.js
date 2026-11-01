/**
 * Phase 6 — Advanced Skill Exchange Algorithm (Step 3 - Substage 3.1)
 * services/reservationService.js
 *
 * Implements atomic participant reservations across both bilateral and circular exchanges.
 * Uses the unique index on `ExchangeReservation.participant` to guarantee database-level
 * mutual exclusion, preventing participants from holding multiple concurrent active exchanges.
 *
 * Supports multi-document transactions when running on MongoDB Replica Sets / Mongos (Atlas),
 * while maintaining safe standalone execution with atomic unique constraints for local/test runs.
 */

'use strict';

const mongoose = require('mongoose');
const ExchangeReservation = require('../models/ExchangeReservation');
const SwapRequest = require('../models/SwapRequest');

/**
 * Custom error class for reservation conflicts.
 */
class ReservationConflictError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ReservationConflictError';
    this.code = 'RESERVATION_CONFLICT';
    this.status = 409;
    this.details = details;
  }
}

/**
 * Checks whether the connected MongoDB topology supports multi-document transactions.
 * Transactions are supported on Replica Sets and Mongos/Sharded clusters.
 *
 * @returns {boolean}
 */
function isTransactionSupported() {
  const topo = mongoose.connection?.client?.topology;
  if (!topo || !topo.description) return false;
  const desc = topo.description;
  if (desc.type === 'ReplicaSetWithPrimary' || desc.type === 'Sharded') return true;
  if (desc.setName) return true;
  const servers = Array.from(desc.servers?.values() || []);
  if (servers.some(s => s.type === 'RSPrimary' || s.type === 'Mongos')) return true;
  return false;
}

/**
 * Executes a callback within a MongoDB transaction if the connected cluster supports transactions.
 * In production, multi-document transactions are mandatory; unsupported topology fails fast immediately.
 * In development and test environments, falls back to standalone execution while propagating an active
 * ClientSession so session-contract queries and writes execute correctly.
 *
 * @param {Function} callback - async (session) => result
 * @returns {Promise<any>}
 */
async function withTransaction(callback) {
  const supported = isTransactionSupported();

  if (!supported) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'MongoDB multi-document transactions are required in production but unsupported by the connected topology (must be a Replica Set or Sharded Cluster)'
      );
    }
    // Standalone fallback: permitted for development and testing environments only.
    // Propagates an active ClientSession explicitly tagged as non-transactional standalone fallback.
    // Note: Non-transactional fallback relies on database unique indexes and compensating deletes,
    // which do NOT provide ACID multi-document atomicity in the event of abnormal process termination.
    const session = await mongoose.startSession();
    session.isStandaloneFallback = true;
    try {
      const result = await callback(session);
      return result;
    } finally {
      await session.endSession();
    }
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const result = await callback(session);
    await session.commitTransaction();
    return result;
  } catch (err) {
    try {
      await session.abortTransaction();
    } catch (_) {}
    throw err;
  } finally {
    try {
      session.endSession();
    } catch (_) {}
  }
}

/**
 * Validates the transaction-state contract of a provided session.
 *
 * Distinguishes clearly between:
 * 1. An active multi-document transaction (session.inTransaction() === true).
 * 2. An explicitly documented, non-production standalone fallback (session.isStandaloneFallback === true).
 * 3. Invalid, ended, or inactive sessions (which are strictly rejected).
 *
 * In production, multi-document transactions are mandatory; standalone fallback is forbidden.
 * In transaction-supported environments (Replica Set / Sharded), an active transaction is mandatory.
 *
 * @param {any} session
 * @param {Object} [options]
 * @param {boolean} [options.requireActiveTransaction=true] - When true, enforces active transaction or non-production fallback
 * @returns {{ isTransaction: boolean, isStandaloneFallback: boolean }}
 * @throws {Error} If session contract is violated
 */
function validateTransactionSession(session, { requireActiveTransaction = true } = {}) {
  if (!session) {
    throw new Error('A valid active MongoDB transaction session is required');
  }

  const isClientSession =
    session instanceof mongoose.mongo.ClientSession ||
    (typeof session === 'object' && typeof session.hasEnded === 'boolean' && typeof session.endSession === 'function');

  if (!isClientSession) {
    throw new Error('A valid active MongoDB transaction session is required; provided value is not a ClientSession');
  }

  if (session.hasEnded) {
    throw new Error('A valid active MongoDB transaction session is required; session has already ended');
  }

  const inTx = typeof session.inTransaction === 'function' ? session.inTransaction() : false;

  if (inTx) {
    return { isTransaction: true, isStandaloneFallback: false };
  }

  // Session exists but no transaction is active (session.inTransaction() === false)
  if (!requireActiveTransaction) {
    return { isTransaction: false, isStandaloneFallback: false };
  }

  // If the cluster supports transactions, an active transaction is strictly mandatory
  if (isTransactionSupported()) {
    throw new Error(
      'A MongoDB multi-document transaction must be active on the session (session.inTransaction() is false). Call session.startTransaction() before executing transaction-guarded operations.'
    );
  }

  // If the cluster does NOT support transactions (standalone):
  // 1. Production must fail fast — non-transactional fallback is strictly forbidden in production
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'MongoDB multi-document transactions are required in production; non-transactional standalone fallback is forbidden'
    );
  }

  // 2. In non-production standalone development/test environments, only accept sessions
  //    that were explicitly created by withTransaction() as a documented standalone fallback
  if (!session.isStandaloneFallback) {
    throw new Error(
      'Session exists but has no active transaction. Standalone non-transactional execution is permitted in development/test only when explicitly managed via withTransaction() fallback (session.isStandaloneFallback is not set)'
    );
  }

  return { isTransaction: false, isStandaloneFallback: true };
}

/**
 * Asserts that none of the specified participants are currently engaged in an active accepted SwapRequest.
 * Enforces mutual exclusion across legacy bilateral exchanges that were accepted prior to the
 * introduction of the ExchangeReservation system.
 *
 * Requirements:
 * - Requires a valid active MongoDB transaction session (rejects missing, ended, or invalid sessions).
 * - Always attaches the required session to the SwapRequest query.
 * - Rejects invalid or empty participant input.
 * - Checks both fromUser and toUser directions.
 * - Filters strictly to status 'accepted'.
 * - Excludes the current pending SwapRequest ID when provided.
 * - Throws ReservationConflictError (HTTP 409) if any participant has an active accepted swap.
 *
 * @param {Object} params
 * @param {Array<mongoose.Types.ObjectId|string>} params.participantIds - Participant user IDs to check
 * @param {mongoose.Types.ObjectId|string} [params.excludeSwapId] - Current swap ID to exclude from conflict check
 * @param {mongoose.ClientSession} params.session - Mandatory active transaction session
 * @returns {Promise<{ hasConflict: boolean, conflictingSwaps: Array }>}
 * @throws {ReservationConflictError} HTTP 409 if any participant has an active accepted swap
 */
async function assertNoAcceptedSwapConflicts({ participantIds = [], excludeSwapId = null, session = undefined } = {}) {
  // 1. Session contract validation
  validateTransactionSession(session);

  // 2. Participant input validation
  if (!Array.isArray(participantIds) || participantIds.length === 0) {
    throw new Error('participantIds must be a non-empty array of valid participant IDs');
  }

  const validIds = participantIds.map(id => {
    const rawId = id && (id._id || id);
    if (!rawId || !mongoose.Types.ObjectId.isValid(rawId)) {
      throw new Error(`Invalid participant ID provided: ${rawId}`);
    }
    return new mongoose.Types.ObjectId(rawId);
  });

  const filter = {
    $or: [
      { fromUser: { $in: validIds }, status: 'accepted' },
      { toUser:   { $in: validIds }, status: 'accepted' },
    ],
  };

  if (excludeSwapId) {
    const rawExclude = excludeSwapId._id || excludeSwapId;
    if (!mongoose.Types.ObjectId.isValid(rawExclude)) {
      throw new Error(`Invalid excludeSwapId provided: ${rawExclude}`);
    }
    filter._id = { $ne: new mongoose.Types.ObjectId(rawExclude) };
  }

  // 3. Always attach required session to the SwapRequest query
  const query = SwapRequest.find(filter).session(session);

  const conflictingSwaps = await query.lean();

  if (conflictingSwaps.length > 0) {
    const conflictingParticipantIds = new Set();
    const validIdStrs = new Set(validIds.map(id => id.toString()));

    for (const swap of conflictingSwaps) {
      if (validIdStrs.has(swap.fromUser.toString())) {
        conflictingParticipantIds.add(swap.fromUser.toString());
      }
      if (validIdStrs.has(swap.toUser.toString())) {
        conflictingParticipantIds.add(swap.toUser.toString());
      }
    }

    throw new ReservationConflictError(
      'One or more participants currently have an active exchange in progress',
      {
        conflictType: 'ACCEPTED_SWAP_CONFLICT',
        conflictingParticipants: Array.from(conflictingParticipantIds),
        conflictingSwapIds: conflictingSwaps.map(s => s._id.toString()),
        conflictingCount: conflictingSwaps.length,
      }
    );
  }

  return { hasConflict: false, conflictingSwaps: [] };
}

/**
 * Atomically acquires active exchange reservations for a set of participants.
 *
 * Rules:
 * 1. Requires an active MongoDB transaction session (or null in standalone environments).
 *    Throws an error if session is omitted/undefined.
 * 2. If a participant is already reserved for the SAME exchangeId, it is treated
 *    as an idempotent retry and succeeds.
 * 3. If a participant is already reserved for a DIFFERENT exchange, it throws
 *    ReservationConflictError (HTTP 409).
 * 4. Never silently overwrites an existing reservation.
 *
 * @param {Object} params
 * @param {Array<{ participant: any, exchangeType: string, exchangeId: any, skillBeingTaught: string }>} params.reservations
 * @param {mongoose.ClientSession|null} params.session - Transaction session or null for standalone
 * @returns {Promise<{ success: boolean, count: number, reservations: Array }>}
 */
async function acquireReservations({ reservations = [], session = undefined }) {
  validateTransactionSession(session);

  if (!Array.isArray(reservations) || reservations.length === 0) {
    return { success: true, count: 0, reservations: [] };
  }

  // Validate and normalize entries
  const normalized = reservations.map(r => {
    if (!r.participant || !r.exchangeType || !r.exchangeId || !r.skillBeingTaught) {
      throw new Error('Each reservation must include participant, exchangeType, exchangeId, and skillBeingTaught');
    }
    return {
      participant: new mongoose.Types.ObjectId(r.participant._id || r.participant),
      exchangeType: r.exchangeType,
      exchangeId: new mongoose.Types.ObjectId(r.exchangeId._id || r.exchangeId),
      skillBeingTaught: r.skillBeingTaught.trim(),
      status: 'active',
    };
  });

  const participantIds = normalized.map(r => r.participant);

  // 1. Check for existing reservations within the transaction session (or standalone query)
  const query = ExchangeReservation.find({
    participant: { $in: participantIds },
  });
  if (session) query.session(session);
  const existingReservations = await query;

  const existingByParticipant = new Map();
  for (const res of existingReservations) {
    existingByParticipant.set(res.participant.toString(), res);
  }

  const toInsert = [];

  for (const item of normalized) {
    const pStr = item.participant.toString();
    const existing = existingByParticipant.get(pStr);

    if (existing) {
      // Existing reservation for the EXACT SAME exchange is an idempotent retry
      if (existing.exchangeId.toString() === item.exchangeId.toString()) {
        continue;
      }
      // Existing reservation for a DIFFERENT exchange is a concurrency conflict
      throw new ReservationConflictError(
        `Participant ${pStr} is already engaged in another active exchange (${existing.exchangeType} ${existing.exchangeId})`,
        {
          conflictingParticipant: item.participant,
          conflictingExchangeId: existing.exchangeId,
          conflictingExchangeType: existing.exchangeType,
        }
      );
    }

    toInsert.push(item);
  }

  // 2. Insert any newly required reservations atomically
  if (toInsert.length > 0) {
    try {
      const options = session ? { session } : {};
      await ExchangeReservation.insertMany(toInsert, options);
    } catch (err) {
      if (!session) {
        // In standalone mode, if insertion threw halfway, clean up any inserted records for this exchangeId
        await ExchangeReservation.deleteMany({ exchangeId: normalized[0].exchangeId });
      }

      // Catch duplicate-key error (E11000) from concurrent race conditions
      if (err.code === 11000 || (err.writeErrors && err.writeErrors.some(e => e.code === 11000))) {
        const raceQuery = ExchangeReservation.find({
          participant: { $in: participantIds },
        });
        if (session) raceQuery.session(session);
        const raceCheck = await raceQuery;

        for (const item of normalized) {
          const rec = raceCheck.find(r => r.participant.toString() === item.participant.toString());
          if (rec && rec.exchangeId.toString() !== item.exchangeId.toString()) {
            throw new ReservationConflictError(
              `Participant ${item.participant} was reserved concurrently by another exchange (${rec.exchangeType} ${rec.exchangeId})`,
              {
                conflictingParticipant: item.participant,
                conflictingExchangeId: rec.exchangeId,
                conflictingExchangeType: rec.exchangeType,
              }
            );
          }
        }
        // If all reservations match target exchange, treat race as idempotent success
      } else {
        throw err;
      }
    }
  }

  return { success: true, count: normalized.length, reservations: normalized };
}

/**
 * Releases reservations belonging strictly to the specified exchange.
 * Safe and idempotent: releasing already-released reservations succeeds with count 0.
 *
 * @param {Object} params
 * @param {string|mongoose.Types.ObjectId} params.exchangeId
 * @param {mongoose.ClientSession|null} [params.session=null]
 * @returns {Promise<{ success: boolean, releasedCount: number }>}
 */
async function releaseReservations({ exchangeId, session = null } = {}) {
  if (!exchangeId) {
    return { success: true, releasedCount: 0 };
  }

  const exObjId = new mongoose.Types.ObjectId(exchangeId._id || exchangeId);
  const queryOptions = session ? { session } : {};

  const result = await ExchangeReservation.deleteMany(
    { exchangeId: exObjId },
    queryOptions
  );

  return { success: true, releasedCount: result.deletedCount || 0 };
}

/**
 * Returns active reservations for the given participant(s).
 *
 * @param {string|mongoose.Types.ObjectId|Array} participantIds
 * @param {Object} [options]
 * @param {mongoose.ClientSession} [options.session]
 * @returns {Promise<Array>}
 */
async function getActiveReservations(participantIds, options = {}) {
  if (!participantIds) return [];

  const rawList = Array.isArray(participantIds) ? participantIds : [participantIds];
  const validIds = rawList
    .map(id => (id ? new mongoose.Types.ObjectId(id._id || id) : null))
    .filter(Boolean);

  if (validIds.length === 0) return [];

  const query = ExchangeReservation.find({
    participant: { $in: validIds },
    status: 'active',
  });

  if (options.session) {
    query.session(options.session);
  }

  return query.lean();
}

/**
 * Performs a controlled, idempotent legacy backfill of accepted bilateral swaps.
 *
 * Rules:
 * - One accepted legacy swap per participant: reserves it.
 * - More than one accepted legacy swap per participant: flags a conflict.
 * - Does not arbitrarily pick newest or oldest swap.
 * - Does not create a reservation for an ambiguous participant.
 * - Logs structured warnings for all conflicted participants.
 * - Does not modify or delete existing SwapRequest records.
 *
 * @param {Object} [options]
 * @param {boolean} [options.dryRun=false]
 * @param {Object} [options.logger=console]
 * @returns {Promise<Object>} Backfill audit summary
 */
async function backfillLegacyReservations(options = {}) {
  const dryRun = Boolean(options.dryRun);
  const logger = options.logger || console;

  const query = { status: 'accepted' };
  if (options.swapIds && Array.isArray(options.swapIds)) {
    query._id = { $in: options.swapIds.map(id => new mongoose.Types.ObjectId(id._id || id)) };
  } else if (options.participantIds && Array.isArray(options.participantIds)) {
    const pIds = options.participantIds.map(id => new mongoose.Types.ObjectId(id._id || id));
    query.$or = [
      { fromUser: { $in: pIds } },
      { toUser: { $in: pIds } },
    ];
  }

  const acceptedSwaps = await SwapRequest.find(query).lean();

  const participantSwaps = new Map();
  for (const swap of acceptedSwaps) {
    const fromId = swap.fromUser.toString();
    const toId = swap.toUser.toString();

    if (!participantSwaps.has(fromId)) participantSwaps.set(fromId, []);
    participantSwaps.get(fromId).push(swap);

    if (!participantSwaps.has(toId)) participantSwaps.set(toId, []);
    participantSwaps.get(toId).push(swap);
  }

  const conflictedParticipants = new Map();
  const unambiguousParticipants = new Set();

  for (const [userId, swaps] of participantSwaps.entries()) {
    if (swaps.length > 1) {
      const swapIds = swaps.map(s => s._id.toString());
      conflictedParticipants.set(userId, swapIds);
      logger.warn(JSON.stringify({
        level: 'WARN',
        event: 'LEGACY_RESERVATION_CONFLICT',
        participantId: userId,
        activeSwapCount: swaps.length,
        conflictingSwapIds: swapIds,
        message: `Participant ${userId} has ${swaps.length} multiple active accepted bilateral swaps. Backfill will NOT create a reservation for this participant. Conflict requires manual administrative resolution.`,
      }));
    } else {
      unambiguousParticipants.add(userId);
    }
  }

  const existingReservations = await ExchangeReservation.find({}).lean();
  const alreadyReservedParticipants = new Set(
    existingReservations.map(r => r.participant.toString())
  );

  const reservationsToCreate = [];

  for (const userId of unambiguousParticipants) {
    if (alreadyReservedParticipants.has(userId)) {
      continue; // Idempotent: already reserved
    }

    const swap = participantSwaps.get(userId)[0];
    const isFromUser = swap.fromUser.toString() === userId;
    const skillBeingTaught = isFromUser ? swap.offeredSkill : swap.wantedSkill;

    reservationsToCreate.push({
      participant: new mongoose.Types.ObjectId(userId),
      exchangeType: 'bilateral',
      exchangeId: swap._id,
      skillBeingTaught: (skillBeingTaught || '').trim(),
      status: 'active',
    });
  }

  const summary = {
    dryRun,
    totalAcceptedSwaps: acceptedSwaps.length,
    totalParticipants: participantSwaps.size,
    unambiguousCount: unambiguousParticipants.size,
    conflictedCount: conflictedParticipants.size,
    conflicts: Array.from(conflictedParticipants.entries()).map(([pId, swapIds]) => ({
      participantId: pId,
      conflictingSwapIds: swapIds,
    })),
    plannedReservationsCount: reservationsToCreate.length,
    backfilledCount: 0,
    createdReservationIds: [],
  };

  if (!dryRun && reservationsToCreate.length > 0) {
    const inserted = await ExchangeReservation.insertMany(reservationsToCreate, { ordered: false });
    summary.backfilledCount = inserted.length;
    summary.createdReservationIds = inserted.map(r => r._id);
  }

  return summary;
}

module.exports = {
  ReservationConflictError,
  isTransactionSupported,
  withTransaction,
  validateTransactionSession,
  assertNoAcceptedSwapConflicts,
  acquireReservations,
  releaseReservations,
  getActiveReservations,
  backfillLegacyReservations,
};
