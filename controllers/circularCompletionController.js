/**
 * Phase 6 — Advanced Skill Exchange Algorithm (Step 3 - Substage 3.4.2)
 * controllers/circularCompletionController.js
 *
 * Implements a safe completion workflow for individual legs of an active
 * three-person CircularExchange:
 * - Teacher marks their leg as teacher-completed (`scheduled → teacher_completed`).
 * - Learner confirms completion (`teacher_completed → completed`).
 * - Child SwapRequest status is synchronized to `completed` upon mutual confirmation.
 * - Idempotent requests return HTTP 200 without creating duplicate history or outbox events.
 * - Strict authorization: only the leg's teacher can mark teacher-completed;
 *   only the leg's learner can confirm; nonparticipants receive HTTP 403.
 * - Concurrency protection: atomic conditional database updates prevent races.
 * - Reliability attribution: teacher gains completed session credit only upon learner confirmation;
 *   learner does not receive duplicate credit; repeated requests do not double count.
 * - Outbox events created inside transactions for both stages.
 */

'use strict';

const mongoose = require('mongoose');
const CircularExchange = require('../models/CircularExchange');
const SwapRequest = require('../models/SwapRequest');
const User = require('../models/User');
const OutboxEvent = require('../models/OutboxEvent');
const { withTransaction, isTransactionSupported } = require('../services/reservationService');

/**
 * PUT /api/circular/:id/legs/:legIndex/complete
 * Teacher marks their assigned teaching leg as completed (`scheduled → teacher_completed`).
 * Requires:
 * - Circular exchange must be active.
 * - Leg must be in 'scheduled' status with an existing scheduledAt timestamp.
 * - Caller must be the assigned teacher of this leg.
 * - Idempotent: repeated calls when already 'teacher_completed' or 'completed' return 200 OK.
 */
async function teacherCompleteLeg(req, res) {
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

    const trimmedNotes = (req.body?.notes || '').trim().slice(0, 500);
    let result = null;

    await withTransaction(async (session) => {
      const exchange = await CircularExchange.findById(req.params.id).session(session);
      if (!exchange) {
        const err = new Error('Circular exchange not found');
        err.status = 404;
        throw err;
      }

      if (exchange.status !== 'active') {
        const err = new Error(`Cannot complete leg: circular exchange is ${exchange.status}`);
        err.status = 400;
        throw err;
      }

      const leg = exchange.legs.find(l => l.legIndex === legIndex) || exchange.legs[legIndex];
      if (!leg) {
        const err = new Error(`Leg at index ${legIndex} not found`);
        err.status = 404;
        throw err;
      }

      // Check whether caller is a participant in this exchange
      const isParticipant = exchange.participants.some(
        p => (p.user?._id || p.user).toString() === req.userId.toString()
      );
      if (!isParticipant) {
        const err = new Error('Forbidden: You are not a participant in this circular exchange');
        err.status = 403;
        throw err;
      }

      // Authorization: Only the assigned teacher can mark teacher-completed
      if (leg.teacher.toString() !== req.userId.toString()) {
        const err = new Error('Forbidden: Only the teacher of this leg may mark it as completed');
        err.status = 403;
        throw err;
      }

      // Idempotency: If leg is already teacher_completed, return 200 without duplicate records
      if (leg.status === 'teacher_completed') {
        result = {
          statusCode: 200,
          data: {
            message: 'Leg is already marked completed by teacher; awaiting learner confirmation',
            legIndex,
            status: leg.status,
            teacherCompletedAt: leg.teacherCompletedAt,
            scheduledAt: leg.scheduledAt,
            completionHistory: leg.completionHistory || [],
          },
        };
        return;
      }

      // Idempotency: If leg is already fully completed, return 200
      if (leg.status === 'completed') {
        result = {
          statusCode: 200,
          data: {
            message: 'Leg is already fully completed',
            legIndex,
            status: leg.status,
            completedAt: leg.completedAt,
            teacherCompletedAt: leg.teacherCompletedAt,
            learnerConfirmedAt: leg.learnerConfirmedAt,
            scheduledAt: leg.scheduledAt,
            completionHistory: leg.completionHistory || [],
          },
        };
        return;
      }

      // Leg must be in 'scheduled' status to transition to 'teacher_completed'
      if (leg.status !== 'scheduled' || !leg.scheduledAt) {
        const err = new Error(`Cannot complete leg: leg must be scheduled first (current status: ${leg.status})`);
        err.status = 400;
        throw err;
      }

      previousState = {
        status: leg.status,
        teacherCompletedAt: leg.teacherCompletedAt,
        teacherCompletedBy: leg.teacherCompletedBy,
      };

      const completionTimestamp = new Date();
      const historyItem = {
        status: 'teacher_completed',
        actionBy: req.userId,
        actionAt: completionTimestamp,
        notes: trimmedNotes || 'Marked completed by teacher',
      };

      // Atomic conditional update guarded by status: 'scheduled'
      const updatedExchange = await CircularExchange.findOneAndUpdate(
        {
          _id: exchange._id,
          status: 'active',
          [`legs.${legIndex}.status`]: 'scheduled',
        },
        {
          $set: {
            [`legs.${legIndex}.status`]: 'teacher_completed',
            [`legs.${legIndex}.teacherCompletedAt`]: completionTimestamp,
            [`legs.${legIndex}.teacherCompletedBy`]: req.userId,
          },
          $push: {
            [`legs.${legIndex}.completionHistory`]: historyItem,
          },
        },
        { returnDocument: 'after', session }
      );

      if (!updatedExchange) {
        // Concurrently modified: inspect latest state for idempotency
        const latest = await CircularExchange.findById(exchange._id).session(session);
        const currentLeg = latest?.legs?.find(l => l.legIndex === legIndex) || latest?.legs[legIndex];
        if (currentLeg && (currentLeg.status === 'teacher_completed' || currentLeg.status === 'completed')) {
          result = {
            statusCode: 200,
            data: {
              message: 'Leg is already marked completed by teacher; awaiting learner confirmation',
              legIndex,
              status: currentLeg.status,
              teacherCompletedAt: currentLeg.teacherCompletedAt,
              scheduledAt: currentLeg.scheduledAt,
              completionHistory: currentLeg.completionHistory || [],
            },
          };
          return;
        }
        const err = new Error('Concurrent completion modification detected. Please reload.');
        err.status = 409;
        throw err;
      }

      mutated = true;

      // Note: Child SwapRequest.status remains 'accepted' until learner confirms!
      // This guarantees reliability is not attributed until mutual confirmation.

      // Transactional OutboxEvent for the learner
      const teacher = await User.findById(req.userId).session(session).select('name');
      const teacherName = teacher?.name || 'Your teacher';

      await OutboxEvent.create(
        [
          {
            aggregateType: 'circular_exchange',
            aggregateId: exchange._id,
            recipient: leg.learner,
            sender: req.userId,
            type: 'CIRCULAR_LEG_TEACHER_COMPLETED',
            title: 'Circular Session Completed by Teacher 🎓',
            message: `${teacherName} marked leg ${legIndex} (${leg.skill}) as completed. Please confirm to finalize!`,
            relatedSwap: leg.swapRequest || null,
            status: 'pending',
          },
        ],
        { session }
      );

      const updatedLeg = updatedExchange.legs.find(l => l.legIndex === legIndex) || updatedExchange.legs[legIndex];

      result = {
        statusCode: 200,
        data: {
          message: 'Leg marked as completed by teacher successfully; awaiting learner confirmation',
          legIndex,
          status: updatedLeg.status,
          teacherCompletedAt: updatedLeg.teacherCompletedAt,
          scheduledAt: updatedLeg.scheduledAt,
          completionHistory: updatedLeg.completionHistory,
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
              [`legs.${legIndex}.teacherCompletedAt`]: previousState.teacherCompletedAt,
              [`legs.${legIndex}.teacherCompletedBy`]: previousState.teacherCompletedBy,
            },
            $pop: { [`legs.${legIndex}.completionHistory`]: 1 },
          }
        );
      } catch (_) {}
    }

    if (err.status) {
      return res.status(err.status).json({ message: err.message });
    }
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
}

/**
 * PUT /api/circular/:id/legs/:legIndex/complete/confirm
 * Learner confirms completion of their assigned learning leg (`teacher_completed → completed`).
 * Requires:
 * - Circular exchange must be active.
 * - Leg must be in 'teacher_completed' status.
 * - Caller must be the assigned learner of this leg.
 * - Synchronizes child SwapRequest.status to 'completed'.
 * - Attributes successful teaching session to teacher's reliability metrics.
 * - Idempotent: repeated calls when already 'completed' return 200 OK with zero duplicate records.
 */
async function learnerConfirmLegCompletion(req, res) {
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

    const trimmedNotes = (req.body?.notes || '').trim().slice(0, 500);
    let result = null;

    await withTransaction(async (session) => {
      const exchange = await CircularExchange.findById(req.params.id).session(session);
      if (!exchange) {
        const err = new Error('Circular exchange not found');
        err.status = 404;
        throw err;
      }

      if (exchange.status !== 'active') {
        const err = new Error(`Cannot confirm completion: circular exchange is ${exchange.status}`);
        err.status = 400;
        throw err;
      }

      const leg = exchange.legs.find(l => l.legIndex === legIndex) || exchange.legs[legIndex];
      if (!leg) {
        const err = new Error(`Leg at index ${legIndex} not found`);
        err.status = 404;
        throw err;
      }

      // Check whether caller is a participant in this exchange
      const isParticipant = exchange.participants.some(
        p => (p.user?._id || p.user).toString() === req.userId.toString()
      );
      if (!isParticipant) {
        const err = new Error('Forbidden: You are not a participant in this circular exchange');
        err.status = 403;
        throw err;
      }

      // Authorization: Only the assigned learner can confirm completion
      if (leg.learner.toString() !== req.userId.toString()) {
        const err = new Error('Forbidden: Only the learner of this leg may confirm completion');
        err.status = 403;
        throw err;
      }

      // Idempotency: If leg is already confirmed 'completed', return 200 without duplicate records
      if (leg.status === 'completed') {
        result = {
          statusCode: 200,
          data: {
            message: 'Leg completion is already confirmed',
            legIndex,
            status: leg.status,
            completedAt: leg.completedAt,
            teacherCompletedAt: leg.teacherCompletedAt,
            learnerConfirmedAt: leg.learnerConfirmedAt,
            scheduledAt: leg.scheduledAt,
            completionHistory: leg.completionHistory || [],
          },
        };
        return;
      }

      // Cannot confirm if teacher has not marked complete yet
      if (leg.status === 'scheduled' || leg.status === 'active') {
        const err = new Error('Cannot confirm completion: Teacher has not marked this leg completed yet');
        err.status = 400;
        throw err;
      }

      // Must be in 'teacher_completed' status
      if (leg.status !== 'teacher_completed') {
        const err = new Error(`Cannot confirm completion: Leg is in ${leg.status} status`);
        err.status = 400;
        throw err;
      }

      previousState = {
        status: leg.status,
        learnerConfirmedAt: leg.learnerConfirmedAt,
        learnerConfirmedBy: leg.learnerConfirmedBy,
        completedAt: leg.completedAt,
        swapRequest: leg.swapRequest,
      };

      const confirmationTimestamp = new Date();
      const historyItem = {
        status: 'completed',
        actionBy: req.userId,
        actionAt: confirmationTimestamp,
        notes: trimmedNotes || 'Confirmed completed by learner',
      };

      // Atomic conditional update guarded by status: 'teacher_completed'
      const updatedExchange = await CircularExchange.findOneAndUpdate(
        {
          _id: exchange._id,
          status: 'active',
          [`legs.${legIndex}.status`]: 'teacher_completed',
        },
        {
          $set: {
            [`legs.${legIndex}.status`]: 'completed',
            [`legs.${legIndex}.learnerConfirmedAt`]: confirmationTimestamp,
            [`legs.${legIndex}.learnerConfirmedBy`]: req.userId,
            [`legs.${legIndex}.completedAt`]: confirmationTimestamp,
          },
          $push: {
            [`legs.${legIndex}.completionHistory`]: historyItem,
          },
        },
        { returnDocument: 'after', session }
      );

      if (!updatedExchange) {
        // Concurrently confirmed: check if already completed
        const latest = await CircularExchange.findById(exchange._id).session(session);
        const currentLeg = latest?.legs?.find(l => l.legIndex === legIndex) || latest?.legs[legIndex];
        if (currentLeg && currentLeg.status === 'completed') {
          result = {
            statusCode: 200,
            data: {
              message: 'Leg completion is already confirmed',
              legIndex,
              status: currentLeg.status,
              completedAt: currentLeg.completedAt,
              teacherCompletedAt: currentLeg.teacherCompletedAt,
              learnerConfirmedAt: currentLeg.learnerConfirmedAt,
              scheduledAt: currentLeg.scheduledAt,
              completionHistory: currentLeg.completionHistory || [],
            },
          };
          return;
        }
        const err = new Error('Concurrent completion confirmation detected. Please reload.');
        err.status = 409;
        throw err;
      }

      // Synchronize child SwapRequest status to 'completed'
      if (leg.swapRequest) {
        await SwapRequest.updateOne(
          { _id: leg.swapRequest },
          { $set: { status: 'completed' } },
          { session }
        );
      }

      mutated = true;

      // Transactional OutboxEvent for the teacher
      const learner = await User.findById(req.userId).session(session).select('name');
      const learnerName = learner?.name || 'Your learner';

      await OutboxEvent.create(
        [
          {
            aggregateType: 'circular_exchange',
            aggregateId: exchange._id,
            recipient: leg.teacher,
            sender: req.userId,
            type: 'CIRCULAR_LEG_COMPLETED',
            title: 'Circular Session Confirmed Complete! ⭐',
            message: `${learnerName} confirmed completion for leg ${legIndex} (${leg.skill}). Great job!`,
            relatedSwap: leg.swapRequest || null,
            status: 'pending',
          },
        ],
        { session }
      );

      const updatedLeg = updatedExchange.legs.find(l => l.legIndex === legIndex) || updatedExchange.legs[legIndex];

      result = {
        statusCode: 200,
        data: {
          message: 'Leg completion confirmed successfully',
          legIndex,
          status: updatedLeg.status,
          completedAt: updatedLeg.completedAt,
          teacherCompletedAt: updatedLeg.teacherCompletedAt,
          learnerConfirmedAt: updatedLeg.learnerConfirmedAt,
          scheduledAt: updatedLeg.scheduledAt,
          completionHistory: updatedLeg.completionHistory,
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
              [`legs.${legIndex}.learnerConfirmedAt`]: previousState.learnerConfirmedAt,
              [`legs.${legIndex}.learnerConfirmedBy`]: previousState.learnerConfirmedBy,
              [`legs.${legIndex}.completedAt`]: previousState.completedAt,
            },
            $pop: { [`legs.${legIndex}.completionHistory`]: 1 },
          }
        );
        if (previousState.swapRequest) {
          await SwapRequest.updateOne(
            { _id: previousState.swapRequest },
            { $set: { status: 'accepted' } }
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

module.exports = {
  teacherCompleteLeg,
  learnerConfirmLegCompletion,
};
