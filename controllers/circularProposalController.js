/**
 * Phase 6 — Advanced Skill Exchange Algorithm (Step 3 - Substage 3.3)
 * controllers/circularProposalController.js
 *
 * Implements the Circular Three-Way Skill Exchange proposal & activation lifecycle:
 * - Propose a 3-way circular exchange with server-side validation & canonical hashing.
 * - Automatic initiator acceptance; pending status for the other two invitees.
 * - Authenticated listing and detail views strictly restricted to participants.
 * - Accept and decline actions with transactional outbox event creation.
 * - 72-hour lazy expiration and background sweeper preserving historical records.
 * - Substage 3.3 Atomic Circular Activation: 3rd acceptance triggers transactional activation:
 *   - Participant conflict checking (assertNoAcceptedSwapConflicts)
 *   - Atomic reservation acquisition (acquireReservations)
 *   - Parent status transition to 'active' with activatedAt timestamp
 *   - Generation of 3 child SwapRequest records linked to parent exchange and legs
 *   - Transactional CIRCULAR_SWAP_ACTIVATED outbox events for all 3 participants
 */

'use strict';

const mongoose = require('mongoose');
const CircularExchange = require('../models/CircularExchange');
const OutboxEvent = require('../models/OutboxEvent');
const User = require('../models/User');
const SwapRequest = require('../models/SwapRequest');
const ExchangeReservation = require('../models/ExchangeReservation');
const {
  withTransaction,
  acquireReservations,
  releaseReservations,
  assertNoAcceptedSwapConflicts,
  ReservationConflictError,
  isTransactionSupported,
} = require('../services/reservationService');

const PROPOSAL_TTL_MS = 72 * 60 * 60 * 1000; // 72 hours

/**
 * Lazy-checks and applies expiration to a circular proposal document.
 * Transitions 'proposed' status to 'expired' if expiresAt has passed.
 *
 * @param {Object} proposal - Mongoose document or plain object
 * @param {Object} [session] - Optional Mongoose transaction session
 * @returns {Promise<boolean>} True if proposal was/is expired
 */
async function checkAndApplyLazyExpiration(proposal, session = null) {
  if (!proposal) return false;

  if (proposal.status === 'expired') {
    return true;
  }

  if (proposal.status === 'proposed' && proposal.expiresAt && new Date(proposal.expiresAt) <= new Date()) {
    proposal.status = 'expired';
    proposal.cancelReason = 'Proposal expired after 72 hours without full participant acceptance';
    if (typeof proposal.save === 'function') {
      const opts = session ? { session } : {};
      await proposal.save(opts);
    } else {
      await CircularExchange.updateOne(
        { _id: proposal._id, status: 'proposed' },
        { $set: { status: 'expired', cancelReason: proposal.cancelReason } }
      );
    }
    return true;
  }

  return false;
}

/**
 * Sweeps all pending circular proposals that have exceeded their 72-hour TTL.
 * Preserves historical records; never performs TTL deletion.
 *
 * @returns {Promise<{ matchedCount: number, modifiedCount: number }>}
 */
async function sweepExpiredCircularProposals() {
  const now = new Date();
  const result = await CircularExchange.updateMany(
    {
      status: 'proposed',
      expiresAt: { $lte: now },
    },
    {
      $set: {
        status: 'expired',
        cancelReason: 'Proposal expired after 72 hours without full participant acceptance',
      },
    }
  );
  return {
    matchedCount: result.matchedCount ?? result.n ?? 0,
    modifiedCount: result.modifiedCount ?? result.nModified ?? 0,
  };
}

/**
 * POST /api/circular/proposals
 * Create a new 3-way circular exchange proposal.
 */
async function createCircularProposal(req, res) {
  try {
    const { legs, cycleScore } = req.body;
    let participants = req.body.participants;

    if (!Array.isArray(legs) || legs.length !== 3) {
      return res.status(400).json({
        message: 'A circular exchange proposal requires exactly 3 directed legs',
      });
    }

    // Extract or normalize participant IDs
    let participantIds = [];
    if (Array.isArray(participants) && participants.length === 3) {
      participantIds = participants.map(p => (p.user ? p.user.toString() : p.toString()));
    } else {
      // Inferred from leg teachers
      participantIds = legs.map(l => {
        const t = l.teacher?._id || l.teacher;
        return t ? t.toString() : '';
      });
    }

    // Validate participant IDs
    for (const pId of participantIds) {
      if (!pId || !mongoose.Types.ObjectId.isValid(pId)) {
        return res.status(400).json({ message: 'Invalid participant ID in cycle' });
      }
    }

    const uniquePIds = new Set(participantIds);
    if (uniquePIds.size !== 3) {
      return res.status(400).json({
        message: 'A circular exchange proposal must contain exactly 3 distinct participants',
      });
    }

    // Security check: Acting user must be one of the participants
    if (!participantIds.includes(req.userId.toString())) {
      return res.status(403).json({
        message: 'Forbidden: You can only propose a circular exchange that you participate in',
      });
    }

    // Server-side graph validation & canonical cycle hashing
    let canonicalResult;
    try {
      canonicalResult = CircularExchange.validateAndCanonicalize(participantIds, legs);
    } catch (err) {
      return res.status(400).json({
        message: `Invalid cycle structure: ${err.message}`,
      });
    }

    const { canonicalCycleHash, orderedLegs } = canonicalResult;

    // Validate that all participants exist and verify no mutual blocking
    const users = await User.find({ _id: { $in: participantIds } }).select('_id name blockedUsers');
    if (users.length !== 3) {
      return res.status(400).json({ message: 'One or more cycle participants do not exist' });
    }

    const userMap = new Map(users.map(u => [u._id.toString(), u]));
    for (const u1 of users) {
      for (const u2 of users) {
        if (u1._id.toString() !== u2._id.toString()) {
          const blocked1 = u1.blockedUsers && u1.blockedUsers.some(b => b.toString() === u2._id.toString());
          const blocked2 = u2.blockedUsers && u2.blockedUsers.some(b => b.toString() === u1._id.toString());
          if (blocked1 || blocked2) {
            return res.status(400).json({
              message: 'Cannot propose exchange: mutual blocking between participants',
            });
          }
        }
      }
    }

    // Check for existing proposed or active cycle with identical canonicalCycleHash
    const existingActive = await CircularExchange.findOne({
      canonicalCycleHash,
      status: { $in: ['proposed', 'active'] },
    });
    if (existingActive) {
      return res.status(409).json({
        message: 'A circular exchange proposal for this cycle is already proposed or active',
        proposalId: existingActive._id,
      });
    }

    // Build participants array: initiator auto-accepted, others pending
    const participantSubdocs = participantIds.map(pId => {
      const isInitiator = pId === req.userId.toString();
      return {
        user: pId,
        hasAccepted: isInitiator,
        acceptedAt: isInitiator ? new Date() : null,
      };
    });

    // Build formatted legs array
    const formattedLegs = orderedLegs.map((leg, idx) => ({
      legIndex: idx,
      teacher: leg.teacher?._id || leg.teacher,
      learner: leg.learner?._id || leg.learner,
      skill: leg.skill.trim(),
      category: leg.category ? leg.category.trim() : 'General',
      teacherLevel: leg.teacherLevel || 'Intermediate',
      learnerLevel: leg.learnerLevel !== undefined ? leg.learnerLevel : null,
      status: 'pending',
    }));

    const expiresAt = new Date(Date.now() + PROPOSAL_TTL_MS);

    let createdProposal = null;

    await withTransaction(async (session) => {
      // Re-verify no concurrent duplicate inside transaction session
      const inTxExisting = await CircularExchange.findOne({
        canonicalCycleHash,
        status: { $in: ['proposed', 'active'] },
      }).session(session);

      if (inTxExisting) {
        const err = new Error('A circular exchange proposal for this cycle is already proposed or active');
        err.status = 409;
        throw err;
      }

      const proposal = new CircularExchange({
        initiator: req.userId,
        participants: participantSubdocs,
        legs: formattedLegs,
        canonicalCycleHash,
        cycleScore: typeof cycleScore === 'number' ? cycleScore : 0,
        expiresAt,
        status: 'proposed',
      });

      await proposal.save({ session });
      createdProposal = proposal;

      // Create OutboxEvent records transactionally for the two invitees
      const initiator = userMap.get(req.userId.toString());
      const initiatorName = initiator?.name || 'A user';

      const inviteeIds = participantIds.filter(id => id !== req.userId.toString());
      const outboxEvents = inviteeIds.map(inviteeId => ({
        aggregateType: 'circular_exchange',
        aggregateId: proposal._id,
        recipient: inviteeId,
        sender: req.userId,
        type: 'CIRCULAR_SWAP_PROPOSED',
        title: 'New Circular Skill Exchange Proposal 🔄',
        message: `${initiatorName} invited you to a 3-way circular skill exchange.`,
        status: 'pending',
      }));

      await OutboxEvent.insertMany(outboxEvents, { session });
    });

    return res.status(201).json(createdProposal);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        message: 'A circular exchange proposal for this cycle is already proposed or active',
      });
    }
    if (err.status) {
      return res.status(err.status).json({ message: err.message });
    }
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
}

/**
 * GET /api/circular/proposals
 * List all circular exchange proposals for the authenticated user.
 */
async function getCircularProposals(req, res) {
  try {
    const filter = { 'participants.user': req.userId };
    if (req.query.status) {
      filter.status = req.query.status;
    }

    // Lazy expire any past-due proposed records for this user
    await CircularExchange.updateMany(
      {
        'participants.user': req.userId,
        status: 'proposed',
        expiresAt: { $lte: new Date() },
      },
      {
        $set: {
          status: 'expired',
          cancelReason: 'Proposal expired after 72 hours without full participant acceptance',
        },
      }
    );

    const proposals = await CircularExchange.find(filter)
      .populate('initiator', 'name email averageRating')
      .populate('participants.user', 'name email averageRating availabilitySlots timezone')
      .populate('legs.teacher', 'name email averageRating')
      .populate('legs.learner', 'name email averageRating')
      .sort({ createdAt: -1 });

    return res.status(200).json(proposals);
  } catch (err) {
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
}

/**
 * GET /api/circular/proposals/:id
 * Retrieve details of a specific circular proposal.
 * Restricted strictly to actual participants in the proposal.
 */
async function getCircularProposalById(req, res) {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid proposal ID' });
    }

    let proposal = await CircularExchange.findById(req.params.id)
      .populate('initiator', 'name email averageRating')
      .populate('participants.user', 'name email averageRating availabilitySlots timezone')
      .populate('legs.teacher', 'name email averageRating')
      .populate('legs.learner', 'name email averageRating');

    if (!proposal) {
      return res.status(404).json({ message: 'Proposal not found' });
    }

    // Security check: Only actual participants may view the proposal
    const isParticipant = proposal.participants.some(
      p => (p.user?._id || p.user).toString() === req.userId.toString()
    );
    if (!isParticipant) {
      return res.status(403).json({
        message: 'Forbidden: You are not a participant in this circular exchange proposal',
      });
    }

    // Check and apply lazy expiration
    await checkAndApplyLazyExpiration(proposal);

    return res.status(200).json(proposal);
  } catch (err) {
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
}

/**
 * PUT /api/circular/proposals/:id/accept
 * Accept an invitation to a circular skill exchange proposal.
 *
 * Substage 3.3 Atomic Activation:
 * When the final participant accepts (all 3 participants accepted):
 * - Revalidates activation preconditions and directed cycle structure.
 * - Asserts no accepted bilateral swap conflicts across all 3 participants.
 * - Atomically acquires 3 circular reservations (one per participant's teaching leg).
 * - Generates exactly 3 child SwapRequests linked to parent circular exchange and leg.
 * - Sets parent status to 'active', updates leg swap references, and records activatedAt.
 * - Creates CIRCULAR_SWAP_ACTIVATED OutboxEvent records transactionally for all 3 participants.
 */
async function acceptCircularInvitation(req, res) {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid proposal ID' });
    }

    let result = null;

    await withTransaction(async (session) => {
      const proposal = await CircularExchange.findById(req.params.id).session(session);

      if (!proposal) {
        const err = new Error('Proposal not found');
        err.status = 404;
        throw err;
      }

      // Security check: Only actual participants can accept
      const participant = proposal.participants.find(
        p => p.user.toString() === req.userId.toString()
      );
      if (!participant) {
        const err = new Error('Forbidden: You are not a participant in this circular exchange proposal');
        err.status = 403;
        throw err;
      }

      // Idempotency: If exchange is already active, return 200 without reactivation
      if (proposal.status === 'active') {
        result = {
          statusCode: 200,
          data: {
            message: 'Circular exchange is already active',
            proposal,
            allAccepted: true,
            activated: true,
          },
        };
        return;
      }

      // Check lazy expiration inside transaction
      const isExpired = await checkAndApplyLazyExpiration(proposal, session);
      if (isExpired || proposal.status === 'expired') {
        const err = new Error('Proposal has expired');
        err.status = 400;
        throw err;
      }

      // Must be in 'proposed' status
      if (proposal.status !== 'proposed') {
        const err = new Error(`Cannot accept: proposal is ${proposal.status}`);
        err.status = 400;
        throw err;
      }

      const wasAlreadyAccepted = participant.hasAccepted;

      // Record acceptance if not already recorded
      if (!participant.hasAccepted) {
        participant.hasAccepted = true;
        participant.acceptedAt = new Date();
        await proposal.save({ session });
      }

      const allAccepted = proposal.participants.every(p => p.hasAccepted === true);

      // If not all 3 have accepted yet, this is a partial acceptance
      if (!allAccepted) {
        if (wasAlreadyAccepted) {
          result = {
            statusCode: 200,
            data: {
              message: 'Invitation already accepted',
              proposal,
              allAccepted: false,
              activated: false,
            },
          };
          return;
        }

        // Create OutboxEvent for the other two participants
        const actor = await User.findById(req.userId).session(session).select('name');
        const actorName = actor?.name || 'A participant';

        const otherParticipants = proposal.participants
          .filter(p => p.user.toString() !== req.userId.toString())
          .map(p => p.user);

        const outboxEvents = otherParticipants.map(recipientId => ({
          aggregateType: 'circular_exchange',
          aggregateId: proposal._id,
          recipient: recipientId,
          sender: req.userId,
          type: 'CIRCULAR_SWAP_ACCEPTED_PARTIAL',
          title: 'Circular Exchange Invitation Accepted',
          message: `${actorName} accepted the circular skill exchange proposal.`,
          status: 'pending',
        }));

        await OutboxEvent.insertMany(outboxEvents, { session });

        result = {
          statusCode: 200,
          data: {
            message: 'Invitation accepted successfully.',
            proposal,
            allAccepted: false,
            activated: false,
          },
        };
        return;
      }

      // ── ATOMIC CIRCULAR ACTIVATION (All 3 participants have accepted) ──

      // 1. Validate activation preconditions
      if (proposal.participants.length !== 3) {
        throw new Error('Circular exchange must have exactly 3 participants for activation');
      }
      if (proposal.legs.length !== 3) {
        throw new Error('Circular exchange must have exactly 3 directed legs for activation');
      }

      const participantIds = proposal.participants.map(p => p.user);
      const canonicalResult = CircularExchange.validateAndCanonicalize(participantIds, proposal.legs);
      if (!canonicalResult.valid) {
        throw new Error('Circular exchange cycle validation failed');
      }

      // 2. Protect all three participants: Check for active accepted bilateral swaps
      await assertNoAcceptedSwapConflicts({
        participantIds,
        session,
      });

      // 3. Acquire exactly three circular reservations (one per participant's teaching leg)
      const reservationsToAcquire = proposal.legs.map(leg => ({
        participant: leg.teacher,
        exchangeType: 'circular',
        exchangeId: proposal._id,
        skillBeingTaught: leg.skill,
      }));

      await acquireReservations({ reservations: reservationsToAcquire, session });

      // 4. Atomic conditional transition: Only one concurrent worker can transition from proposed to active
      const activatedDoc = await CircularExchange.findOneAndUpdate(
        { _id: proposal._id, status: 'proposed' },
        { $set: { status: 'active', activatedAt: new Date() } },
        { returnDocument: 'after', session }
      );

      // If another concurrent request already activated this exchange, return cleanly without duplicating
      if (!activatedDoc) {
        const currentActive = await CircularExchange.findById(proposal._id).session(session);

        if (currentActive && currentActive.status === 'active') {
          result = {
            statusCode: 200,
            data: {
              message: 'All participants accepted. Circular exchange successfully activated!',
              proposal: currentActive,
              allAccepted: true,
              activated: true,
            },
          };
          return;
        }

        // Parent exchange was concurrently cancelled, expired, or modified
        const statusMsg = currentActive ? currentActive.status : 'not found';
        const err = new Error(`Cannot activate circular exchange: proposal is ${statusMsg}`);
        err.status = 409;
        throw err;
      }

      // 5. Generate exactly three child SwapRequests (one per directed leg)
      let childSwaps = await SwapRequest.find({ circularExchange: proposal._id }).session(session);

      if (childSwaps.length < 3) {
        if (childSwaps.length > 0) {
          await SwapRequest.deleteMany({ circularExchange: proposal._id }).session(session);
        }
        childSwaps = [];
        for (let i = 0; i < proposal.legs.length; i++) {
          const leg = proposal.legs[i];
          const childSwap = new SwapRequest({
            fromUser: leg.teacher,
            toUser: leg.learner,
            offeredSkill: leg.skill,
            wantedSkill: '[Circular Exchange]',
            status: 'accepted',
            roomId: `skillswap-circular-${proposal._id}-leg-${i}`,
            circularExchange: proposal._id,
            circularLegIndex: i,
            compatibilityScore: proposal.cycleScore || 0,
            compatibilityNote: `Child leg ${i} of 3-way circular skill exchange (${proposal._id})`,
          });
          await childSwap.save({ session });
          childSwaps.push(childSwap);
        }
      }

      // Update parent legs with references and active status
      for (let i = 0; i < activatedDoc.legs.length; i++) {
        const matchingChild = childSwaps.find(cs => cs.circularLegIndex === i) || childSwaps[i];
        activatedDoc.legs[i].swapRequest = matchingChild._id;
        activatedDoc.legs[i].status = 'active';
        activatedDoc.legs[i].roomId = matchingChild.roomId;
      }
      await activatedDoc.save({ session });

      // 6. Transactional outbox events for all 3 participants
      const existingActivationEvents = await OutboxEvent.find({
        aggregateType: 'circular_exchange',
        aggregateId: proposal._id,
        type: 'CIRCULAR_SWAP_ACTIVATED',
      }).session(session);

      if (existingActivationEvents.length === 0) {
        const activationEvents = activatedDoc.participants.map(p => {
          const teachingLeg = activatedDoc.legs.find(l => l.teacher.toString() === p.user.toString());
          return {
            aggregateType: 'circular_exchange',
            aggregateId: activatedDoc._id,
            recipient: p.user,
            sender: req.userId,
            type: 'CIRCULAR_SWAP_ACTIVATED',
            title: 'Circular Skill Exchange Activated! 🚀',
            message: 'All 3 participants have accepted! Your 3-way circular skill exchange is now active.',
            relatedSwap: teachingLeg?.swapRequest || null,
            status: 'pending',
          };
        });
        await OutboxEvent.insertMany(activationEvents, { session });
      }

      result = {
        statusCode: 200,
        data: {
          message: 'All participants accepted. Circular exchange successfully activated!',
          proposal: activatedDoc,
          allAccepted: true,
          activated: true,
        },
      };
    });

    return res.status(result.statusCode).json(result.data);
  } catch (err) {
    // If standalone fallback mode without real transactions, perform compensating cleanup if an error occurred after partial writes
    if (!isTransactionSupported() && req.params && req.params.id) {
      try {
        await CircularExchange.updateOne(
          { _id: req.params.id, status: 'active' },
          {
            $set: {
              status: 'proposed',
              activatedAt: null,
              'legs.$[].status': 'pending',
              'legs.$[].swapRequest': null,
              'legs.$[].roomId': null,
            },
          }
        );
        await SwapRequest.deleteMany({ circularExchange: req.params.id });
        await releaseReservations({ exchangeId: req.params.id });
      } catch (_) {}
    }

    if (err.name === 'ReservationConflictError' || err.code === 'RESERVATION_CONFLICT') {
      return res.status(409).json({
        message: err.message,
        details: err.details,
      });
    }
    if (err.code === 11000) {
      return res.status(409).json({
        message: 'Conflict: One or more participants already hold an active reservation',
      });
    }
    if (err.status) {
      return res.status(err.status).json({ message: err.message });
    }
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
}

/**
 * PUT /api/circular/proposals/:id/decline
 * Decline an invitation to a circular skill exchange proposal.
 * Transitions parent proposal status to 'cancelled'.
 */
async function declineCircularInvitation(req, res) {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid proposal ID' });
    }

    let result = null;

    await withTransaction(async (session) => {
      const proposal = await CircularExchange.findById(req.params.id).session(session);

      if (!proposal) {
        const err = new Error('Proposal not found');
        err.status = 404;
        throw err;
      }

      // Security check: Only actual participants can decline
      const isParticipant = proposal.participants.some(
        p => p.user.toString() === req.userId.toString()
      );
      if (!isParticipant) {
        const err = new Error('Forbidden: You are not a participant in this circular exchange proposal');
        err.status = 403;
        throw err;
      }

      // Idempotent decline: already cancelled by this user
      if (proposal.status === 'cancelled' && proposal.cancelledBy?.toString() === req.userId.toString()) {
        result = {
          statusCode: 200,
          data: {
            message: 'Proposal already declined',
            proposal,
          },
        };
        return;
      }

      // Check lazy expiration
      const isExpired = await checkAndApplyLazyExpiration(proposal, session);
      if (isExpired || proposal.status === 'expired') {
        const err = new Error('Proposal has expired');
        err.status = 400;
        throw err;
      }

      // Must be in 'proposed' status to decline
      if (proposal.status !== 'proposed') {
        const err = new Error(`Cannot decline: proposal is already ${proposal.status}`);
        err.status = 400;
        throw err;
      }

      // Transition to cancelled
      const declineReason = req.body && req.body.reason ? String(req.body.reason).trim() : 'Declined by participant';
      proposal.status = 'cancelled';
      proposal.cancelledBy = req.userId;
      proposal.cancelReason = declineReason;

      await proposal.save({ session });

      // Create OutboxEvent for the other two participants
      const actor = await User.findById(req.userId).session(session).select('name');
      const actorName = actor?.name || 'A participant';

      const otherParticipants = proposal.participants
        .filter(p => p.user.toString() !== req.userId.toString())
        .map(p => p.user);

      const outboxEvents = otherParticipants.map(recipientId => ({
        aggregateType: 'circular_exchange',
        aggregateId: proposal._id,
        recipient: recipientId,
        sender: req.userId,
        type: 'CIRCULAR_SWAP_DECLINED',
        title: 'Circular Skill Exchange Declined',
        message: `${actorName} declined the circular skill exchange proposal.`,
        status: 'pending',
      }));

      await OutboxEvent.insertMany(outboxEvents, { session });

      result = {
        statusCode: 200,
        data: {
          message: 'Proposal declined successfully',
          proposal,
        },
      };
    });

    return res.status(result.statusCode).json(result.data);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ message: err.message });
    }
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
}

module.exports = {
  PROPOSAL_TTL_MS,
  checkAndApplyLazyExpiration,
  sweepExpiredCircularProposals,
  createCircularProposal,
  getCircularProposals,
  getCircularProposalById,
  acceptCircularInvitation,
  declineCircularInvitation,
};
