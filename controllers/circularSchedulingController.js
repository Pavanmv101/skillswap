/**
 * Phase 6 — Advanced Skill Exchange Algorithm (Step 3 - Substage 3.4.1)
 * controllers/circularSchedulingController.js
 *
 * Implements independent scheduling and rescheduling for the 3 child legs
 * of an active Circular Skill Exchange:
 * - Teacher proposes or reschedules a date/time for their teaching leg.
 * - Learner confirms or rejects the proposed schedule.
 * - Mutual confirmation required: child SwapRequest.scheduledAt is ONLY populated on confirmation.
 * - Availability validation against User.availabilitySlots.
 * - Double-booking prevention across both bilateral and circular sessions (±30m window).
 * - Schedule history preserved in parent CircularExchange leg.
 * - Confirmed schedule preserved if subsequent rescheduling is rejected.
 * - Transactional OutboxEvent records created for all schedule state transitions.
 */

'use strict';

const mongoose = require('mongoose');
const CircularExchange = require('../models/CircularExchange');
const SwapRequest = require('../models/SwapRequest');
const User = require('../models/User');
const OutboxEvent = require('../models/OutboxEvent');
const { withTransaction, isTransactionSupported } = require('../services/reservationService');

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const COLLISION_WINDOW_MS = 30 * 60 * 1000; // ±30 minutes

/**
 * Validates whether a proposed date falls within a user's configured availability slots.
 * Evaluates in both local and UTC representations for timezone resilience.
 * If availabilitySlots is empty or unconfigured, returns true (no restrictions).
 *
 * @param {Date} date
 * @param {Array<{ day: string, from: string, to: string }>} slots
 * @returns {boolean}
 */
function isTimeWithinSlots(date, slots) {
  if (!Array.isArray(slots) || slots.length === 0) {
    return true;
  }

  const localDay = DAYS_OF_WEEK[date.getDay()];
  const localHHMM = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

  const utcDay = DAYS_OF_WEEK[date.getUTCDay()];
  const utcHHMM = `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;

  const matchesSlot = (dayName, hhmm) => {
    return slots.some(slot => {
      if (!slot || slot.day !== dayName) return false;
      const from = slot.from || '00:00';
      const to = slot.to || '23:59';
      return hhmm >= from && hhmm <= to;
    });
  };

  return matchesSlot(localDay, localHHMM) || matchesSlot(utcDay, utcHHMM);
}

/**
 * Checks if a participant already has an accepted/confirmed session scheduled within ±30 minutes.
 * Queries SwapRequest across both bilateral swaps and circular child swaps.
 *
 * @param {string|mongoose.Types.ObjectId} userId
 * @param {Date} targetTime
 * @param {string|mongoose.Types.ObjectId|null} [excludeSwapId=null]
 * @param {mongoose.ClientSession|null} [session=null]
 * @returns {Promise<Object|null>} Conflicting swap if found, else null
 */
async function checkDoubleBooking(userId, targetTime, excludeSwapId = null, session = null) {
  const startTime = new Date(targetTime.getTime() - COLLISION_WINDOW_MS);
  const endTime = new Date(targetTime.getTime() + COLLISION_WINDOW_MS);

  const filter = {
    $or: [{ fromUser: userId }, { toUser: userId }],
    status: 'accepted',
    scheduledAt: { $gte: startTime, $lte: endTime },
  };

  if (excludeSwapId) {
    const rawExclude = excludeSwapId._id || excludeSwapId;
    if (mongoose.Types.ObjectId.isValid(rawExclude)) {
      filter._id = { $ne: new mongoose.Types.ObjectId(rawExclude) };
    }
  }

  const query = SwapRequest.findOne(filter);
  if (session) query.session(session);
  return query.lean();
}

/**
 * GET /api/circular/:id/schedule
 * Retrieve schedule status, proposals, and history for all legs of a circular exchange.
 * Restricted strictly to actual participants in the exchange.
 */
async function getCircularSchedule(req, res) {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid circular exchange ID' });
    }

    const exchange = await CircularExchange.findById(req.params.id)
      .populate('participants.user', 'name email averageRating availabilitySlots')
      .populate('legs.teacher', 'name email averageRating availabilitySlots')
      .populate('legs.learner', 'name email averageRating availabilitySlots')
      .populate('legs.swapRequest', 'status scheduledAt roomId compatibilityScore');

    if (!exchange) {
      return res.status(404).json({ message: 'Circular exchange not found' });
    }

    const isParticipant = exchange.participants.some(
      p => (p.user?._id || p.user).toString() === req.userId.toString()
    );
    if (!isParticipant) {
      return res.status(403).json({
        message: 'Forbidden: You are not a participant in this circular exchange',
      });
    }

    const legsSchedule = exchange.legs.map((leg, index) => {
      const teacherId = (leg.teacher?._id || leg.teacher).toString();
      const learnerId = (leg.learner?._id || leg.learner).toString();
      const currentUserId = req.userId.toString();

      let myRole = 'observer';
      if (currentUserId === teacherId) myRole = 'teacher';
      else if (currentUserId === learnerId) myRole = 'learner';

      const isPendingProposal = leg.scheduleProposal && leg.scheduleProposal.status === 'pending_confirmation';

      return {
        legIndex: leg.legIndex ?? index,
        skill: leg.skill,
        category: leg.category,
        teacher: leg.teacher,
        learner: leg.learner,
        status: leg.status,
        scheduledAt: leg.scheduledAt,
        roomId: leg.roomId,
        swapRequest: leg.swapRequest,
        scheduleProposal: leg.scheduleProposal || { status: 'none' },
        scheduleHistory: leg.scheduleHistory || [],
        myRole,
        canPropose: myRole === 'teacher' && exchange.status === 'active',
        canConfirm: myRole === 'learner' && isPendingProposal && exchange.status === 'active',
        canReject: myRole === 'learner' && isPendingProposal && exchange.status === 'active',
      };
    });

    return res.status(200).json({
      exchangeId: exchange._id,
      status: exchange.status,
      activatedAt: exchange.activatedAt,
      legs: legsSchedule,
    });
  } catch (err) {
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
}

/**
 * POST /api/circular/:id/legs/:legIndex/schedule/propose
 * Teacher proposes or reschedules a date/time for their teaching leg.
 * Does NOT overwrite existing confirmed scheduledAt until learner confirms.
 */
async function proposeLegSchedule(req, res) {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid circular exchange ID' });
    }

    const legIndex = parseInt(req.params.legIndex, 10);
    if (isNaN(legIndex) || legIndex < 0 || legIndex > 2) {
      return res.status(400).json({ message: 'Invalid leg index (must be 0, 1, or 2)' });
    }

    const { scheduledTime } = req.body || {};
    if (!scheduledTime) {
      return res.status(400).json({ message: 'scheduledTime is required' });
    }

    const scheduledDate = new Date(scheduledTime);
    if (isNaN(scheduledDate.getTime())) {
      return res.status(400).json({ message: 'Invalid scheduledTime format' });
    }

    if (scheduledDate <= new Date()) {
      return res.status(400).json({ message: 'Scheduled time must be in the future' });
    }

    let result = null;

    await withTransaction(async (session) => {
      const exchange = await CircularExchange.findById(req.params.id).session(session);
      if (!exchange) {
        const err = new Error('Circular exchange not found');
        err.status = 404;
        throw err;
      }

      if (exchange.status !== 'active') {
        const err = new Error(`Cannot schedule leg: circular exchange is ${exchange.status}`);
        err.status = 400;
        throw err;
      }

      const leg = exchange.legs.find(l => l.legIndex === legIndex) || exchange.legs[legIndex];
      if (!leg) {
        const err = new Error(`Leg at index ${legIndex} not found`);
        err.status = 404;
        throw err;
      }

      // Authorization: Only the teacher of this leg may propose a schedule
      if (leg.teacher.toString() !== req.userId.toString()) {
        const err = new Error('Forbidden: Only the teacher of this leg may propose a schedule');
        err.status = 403;
        throw err;
      }

      // Fetch teacher and learner availability
      const teacher = await User.findById(leg.teacher).session(session).select('name availabilitySlots');
      const learner = await User.findById(leg.learner).session(session).select('name availabilitySlots');

      // Validate availability slots
      if (!isTimeWithinSlots(scheduledDate, teacher?.availabilitySlots)) {
        const err = new Error('Proposed time is outside your configured availability slots');
        err.status = 400;
        throw err;
      }

      if (!isTimeWithinSlots(scheduledDate, learner?.availabilitySlots)) {
        const err = new Error(`Proposed time is outside ${learner?.name || 'the learner'}'s configured availability slots`);
        err.status = 400;
        throw err;
      }

      // Check double-booking for teacher
      const teacherConflict = await checkDoubleBooking(leg.teacher, scheduledDate, leg.swapRequest, session);
      if (teacherConflict) {
        const err = new Error('You already have another confirmed session scheduled around this time');
        err.status = 409;
        throw err;
      }

      // Check double-booking for learner
      const learnerConflict = await checkDoubleBooking(leg.learner, scheduledDate, leg.swapRequest, session);
      if (learnerConflict) {
        const err = new Error(`${learner?.name || 'The learner'} already has another confirmed session scheduled around this time`);
        err.status = 409;
        throw err;
      }

      // Archive previous proposal into scheduleHistory if one was pending
      if (leg.scheduleProposal && leg.scheduleProposal.status === 'pending_confirmation') {
        leg.scheduleHistory.push({
          scheduledTime: leg.scheduleProposal.proposedTime,
          proposedBy: leg.scheduleProposal.proposedBy,
          proposedAt: leg.scheduleProposal.proposedAt,
          status: 'superseded',
          actionBy: req.userId,
          actionAt: new Date(),
          notes: 'Superseded by revised teacher proposal',
        });
      }

      const isReschedule = !!leg.scheduledAt;

      // Update scheduleProposal (scheduledAt remains unchanged until learner confirmation)
      leg.scheduleProposal = {
        proposedTime: scheduledDate,
        proposedBy: req.userId,
        proposedAt: new Date(),
        status: 'pending_confirmation',
        rejectionReason: '',
        respondedAt: null,
      };

      await exchange.save({ session });

      // OutboxEvent creation
      const eventType = isReschedule
        ? 'CIRCULAR_LEG_SCHEDULE_RESCHEDULED'
        : 'CIRCULAR_LEG_SCHEDULE_PROPOSED';

      const formattedDate = scheduledDate.toISOString();
      const teacherName = teacher?.name || 'Your teacher';

      await OutboxEvent.create(
        [
          {
            aggregateType: 'circular_exchange',
            aggregateId: exchange._id,
            recipient: leg.learner,
            sender: req.userId,
            type: eventType,
            title: isReschedule ? 'Circular Session Rescheduled 📅' : 'New Session Schedule Proposed 📅',
            message: `${teacherName} proposed a session for leg ${legIndex} (${leg.skill}) on ${formattedDate}.`,
            relatedSwap: leg.swapRequest || null,
            status: 'pending',
          },
        ],
        { session }
      );

      result = {
        statusCode: 200,
        data: {
          message: isReschedule
            ? 'Rescheduling proposal submitted successfully; awaiting learner confirmation'
            : 'Schedule proposal submitted successfully; awaiting learner confirmation',
          legIndex,
          scheduleProposal: leg.scheduleProposal,
          scheduledAt: leg.scheduledAt,
          status: leg.status,
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

/**
 * PUT /api/circular/:id/legs/:legIndex/schedule/confirm
 * Learner confirms the proposed schedule.
 * Atomically updates parent leg scheduledAt, child SwapRequest scheduledAt, and leg status to 'scheduled'.
 */
async function confirmLegSchedule(req, res) {
  let mutated = false;
  let previousState = null;
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid circular exchange ID' });
    }

    const legIndex = parseInt(req.params.legIndex, 10);
    if (isNaN(legIndex) || legIndex < 0 || legIndex > 2) {
      return res.status(400).json({ message: 'Invalid leg index (must be 0, 1, or 2)' });
    }

    let result = null;

    await withTransaction(async (session) => {
      const exchange = await CircularExchange.findById(req.params.id).session(session);
      if (!exchange) {
        const err = new Error('Circular exchange not found');
        err.status = 404;
        throw err;
      }

      if (exchange.status !== 'active') {
        const err = new Error(`Cannot confirm schedule: circular exchange is ${exchange.status}`);
        err.status = 400;
        throw err;
      }

      const leg = exchange.legs.find(l => l.legIndex === legIndex) || exchange.legs[legIndex];
      if (!leg) {
        const err = new Error(`Leg at index ${legIndex} not found`);
        err.status = 404;
        throw err;
      }

      previousState = {
        scheduledAt: leg.scheduledAt,
        status: leg.status,
        swapRequest: leg.swapRequest,
      };

      // Authorization: Only the learner of this leg may confirm
      if (leg.learner.toString() !== req.userId.toString()) {
        const err = new Error('Forbidden: Only the learner of this leg may confirm the schedule');
        err.status = 403;
        throw err;
      }

      // Must have a pending schedule proposal
      if (!leg.scheduleProposal || leg.scheduleProposal.status !== 'pending_confirmation') {
        const err = new Error('No pending schedule proposal to confirm');
        err.status = 400;
        throw err;
      }

      const confirmedTime = new Date(leg.scheduleProposal.proposedTime);

      // Verify the proposed time has not already passed
      if (confirmedTime <= new Date()) {
        const err = new Error('Proposed session time has already passed');
        err.status = 400;
        throw err;
      }

      // Re-check double-booking at confirmation time
      const teacherConflict = await checkDoubleBooking(leg.teacher, confirmedTime, leg.swapRequest, session);
      if (teacherConflict) {
        const err = new Error('Teacher has a conflicting session scheduled around this time');
        err.status = 409;
        throw err;
      }

      const learnerConflict = await checkDoubleBooking(leg.learner, confirmedTime, leg.swapRequest, session);
      if (learnerConflict) {
        const err = new Error('You already have another confirmed session scheduled around this time');
        err.status = 409;
        throw err;
      }

      // Apply confirmation to parent leg
      leg.scheduledAt = confirmedTime;
      leg.status = 'scheduled';
      leg.scheduleProposal.status = 'confirmed';
      leg.scheduleProposal.respondedAt = new Date();

      leg.scheduleHistory.push({
        scheduledTime: confirmedTime,
        proposedBy: leg.scheduleProposal.proposedBy,
        proposedAt: leg.scheduleProposal.proposedAt,
        status: 'confirmed',
        actionBy: req.userId,
        actionAt: new Date(),
        notes: 'Confirmed by learner',
      });

      // Synchronize child SwapRequest scheduledAt (CRITICAL: only on mutual confirmation)
      if (leg.swapRequest) {
        await SwapRequest.updateOne(
          { _id: leg.swapRequest },
          { $set: { scheduledAt: confirmedTime } },
          { session }
        );
      }

      await exchange.save({ session });
      mutated = true;

      const learner = await User.findById(req.userId).session(session).select('name');
      const learnerName = learner?.name || 'Your learner';
      const formattedDate = confirmedTime.toISOString();

      // Transactional OutboxEvent for the teacher
      await OutboxEvent.create(
        [
          {
            aggregateType: 'circular_exchange',
            aggregateId: exchange._id,
            recipient: leg.teacher,
            sender: req.userId,
            type: 'CIRCULAR_LEG_SCHEDULE_CONFIRMED',
            title: 'Circular Session Schedule Confirmed! ✅',
            message: `${learnerName} confirmed the session for leg ${legIndex} (${leg.skill}) on ${formattedDate}.`,
            relatedSwap: leg.swapRequest || null,
            status: 'pending',
          },
        ],
        { session }
      );

      result = {
        statusCode: 200,
        data: {
          message: 'Schedule proposal confirmed successfully',
          legIndex,
          scheduledAt: confirmedTime,
          status: leg.status,
          scheduleProposal: leg.scheduleProposal,
        },
      };
    });

    return res.status(result.statusCode).json(result.data);
  } catch (err) {
    if (!isTransactionSupported() && mutated && previousState && req.params && req.params.id) {
      try {
        const legIndex = parseInt(req.params.legIndex, 10);
        await CircularExchange.updateOne(
          { _id: req.params.id },
          {
            $set: {
              [`legs.${legIndex}.status`]: previousState.status,
              [`legs.${legIndex}.scheduledAt`]: previousState.scheduledAt,
              [`legs.${legIndex}.scheduleProposal.status`]: 'pending_confirmation',
            },
            $pop: { [`legs.${legIndex}.scheduleHistory`]: 1 },
          }
        );
        if (previousState.swapRequest) {
          await SwapRequest.updateOne(
            { _id: previousState.swapRequest },
            { $set: { scheduledAt: previousState.scheduledAt } }
          );
        }
      } catch (_) {}
    }

    if (err.status) {
      return res.status(err.status).json({ message: err.message });
    }
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
}

/**
 * PUT /api/circular/:id/legs/:legIndex/schedule/reject
 * Learner rejects the proposed schedule.
 * Preserves any previously confirmed scheduledAt; archives rejection to scheduleHistory.
 */
async function rejectLegSchedule(req, res) {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid circular exchange ID' });
    }

    const legIndex = parseInt(req.params.legIndex, 10);
    if (isNaN(legIndex) || legIndex < 0 || legIndex > 2) {
      return res.status(400).json({ message: 'Invalid leg index (must be 0, 1, or 2)' });
    }

    const reason = (req.body?.reason || '').trim().slice(0, 500);

    let result = null;

    await withTransaction(async (session) => {
      const exchange = await CircularExchange.findById(req.params.id).session(session);
      if (!exchange) {
        const err = new Error('Circular exchange not found');
        err.status = 404;
        throw err;
      }

      if (exchange.status !== 'active') {
        const err = new Error(`Cannot reject schedule: circular exchange is ${exchange.status}`);
        err.status = 400;
        throw err;
      }

      const leg = exchange.legs.find(l => l.legIndex === legIndex) || exchange.legs[legIndex];
      if (!leg) {
        const err = new Error(`Leg at index ${legIndex} not found`);
        err.status = 404;
        throw err;
      }

      // Authorization: Only the learner of this leg may reject
      if (leg.learner.toString() !== req.userId.toString()) {
        const err = new Error('Forbidden: Only the learner of this leg may reject the schedule');
        err.status = 403;
        throw err;
      }

      // Must have a pending schedule proposal
      if (!leg.scheduleProposal || leg.scheduleProposal.status !== 'pending_confirmation') {
        const err = new Error('No pending schedule proposal to reject');
        err.status = 400;
        throw err;
      }

      const rejectedTime = leg.scheduleProposal.proposedTime;

      // Archive rejection into scheduleHistory
      leg.scheduleHistory.push({
        scheduledTime: rejectedTime,
        proposedBy: leg.scheduleProposal.proposedBy,
        proposedAt: leg.scheduleProposal.proposedAt,
        status: 'rejected',
        actionBy: req.userId,
        actionAt: new Date(),
        notes: reason || 'Declined by learner',
      });

      // Update proposal state to rejected
      leg.scheduleProposal.status = 'rejected';
      leg.scheduleProposal.rejectionReason = reason;
      leg.scheduleProposal.respondedAt = new Date();

      // Confirmed schedule preservation:
      // If a previous confirmed schedule existed, it remains intact!
      // Leg status remains 'scheduled' if scheduledAt exists, otherwise 'active'.
      if (!leg.scheduledAt) {
        leg.status = 'active';
      }

      await exchange.save({ session });

      const learner = await User.findById(req.userId).session(session).select('name');
      const learnerName = learner?.name || 'Your learner';

      // Transactional OutboxEvent for the teacher
      await OutboxEvent.create(
        [
          {
            aggregateType: 'circular_exchange',
            aggregateId: exchange._id,
            recipient: leg.teacher,
            sender: req.userId,
            type: 'CIRCULAR_LEG_SCHEDULE_REJECTED',
            title: 'Circular Session Schedule Declined ❌',
            message: `${learnerName} declined your proposed schedule for leg ${legIndex} (${leg.skill}).${reason ? ` Reason: ${reason}` : ''}`,
            relatedSwap: leg.swapRequest || null,
            status: 'pending',
          },
        ],
        { session }
      );

      result = {
        statusCode: 200,
        data: {
          message: 'Schedule proposal rejected successfully',
          legIndex,
          scheduledAt: leg.scheduledAt,
          status: leg.status,
          scheduleProposal: leg.scheduleProposal,
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
  getCircularSchedule,
  proposeLegSchedule,
  confirmLegSchedule,
  rejectLegSchedule,
  isTimeWithinSlots,
  checkDoubleBooking,
};
