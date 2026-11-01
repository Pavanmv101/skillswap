const mongoose = require('mongoose');
const SwapRequest = require('../models/SwapRequest');
const User = require('../models/User');
const { createAndEmitNotification } = require('../services/notificationService');
const {
  acquireReservations,
  releaseReservations,
  withTransaction,
  assertNoAcceptedSwapConflicts,
  ReservationConflictError,
} = require('../services/reservationService');

// POST /api/swap
exports.createSwapRequest = async (req, res) => {
  try {
    const { toUser, offeredSkill, wantedSkill, compatibilityScore, compatibilityNote } = req.body;

    if (!toUser || !offeredSkill || !wantedSkill) {
      return res.status(400).json({ message: 'toUser, offeredSkill, and wantedSkill are required' });
    }

    if (!mongoose.Types.ObjectId.isValid(toUser)) {
      return res.status(400).json({ message: 'Invalid target user ID' });
    }

    if (toUser.toString() === req.userId.toString()) {
      return res.status(400).json({ message: 'You cannot propose a skill swap with yourself' });
    }

    // Check target user existence and mutual block lists
    const targetUser = await User.findById(toUser);
    if (!targetUser) {
      return res.status(404).json({ message: 'Target user does not exist' });
    }

    const currentUser = await User.findById(req.userId);
    if (!currentUser) {
      return res.status(404).json({ message: 'Current user not found' });
    }

    if (currentUser.blockedUsers && currentUser.blockedUsers.some(b => b.toString() === toUser.toString())) {
      return res.status(400).json({ message: 'You have blocked this user' });
    }

    if (targetUser.blockedUsers && targetUser.blockedUsers.some(b => b.toString() === req.userId.toString())) {
      return res.status(403).json({ message: 'Cannot propose swap to this user' });
    }

    // Check for existing pending or active swap between the pair in either direction
    const existing = await SwapRequest.findOne({
      $or: [
        { fromUser: req.userId, toUser: toUser, status: 'pending' },
        { fromUser: toUser, toUser: req.userId, status: 'pending' },
        { fromUser: req.userId, toUser: toUser, status: 'accepted' },
        { fromUser: toUser, toUser: req.userId, status: 'accepted' },
      ],
    });

    if (existing) {
      return res.status(400).json({
        message: existing.status === 'accepted'
          ? 'You already have an active swap session in progress with this user'
          : 'A pending swap request already exists between you and this user',
      });
    }

    const swapRequest = new SwapRequest({
      fromUser: req.userId,
      toUser,
      offeredSkill: offeredSkill.trim(),
      wantedSkill: wantedSkill.trim(),
      compatibilityScore: Number(compatibilityScore) || 0,
      compatibilityNote: (compatibilityNote || '').trim(),
    });

    await swapRequest.save();
    await swapRequest.populate('fromUser', 'name email averageRating availabilitySlots');
    await swapRequest.populate('toUser',   'name email averageRating availabilitySlots');

    // Trigger Notification for recipient
    await createAndEmitNotification({
      recipient: toUser,
      sender: req.userId,
      type: 'SWAP_REQUEST',
      title: 'New Skill Swap Request ⚡',
      message: `${currentUser.name} wants to swap skills: offering "${offeredSkill}" in exchange for your "${wantedSkill}".`,
      relatedSwap: swapRequest._id,
    });

    res.status(201).json(swapRequest);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET /api/swap
exports.getSwapRequests = async (req, res) => {
  try {
    const requests = await SwapRequest.find({
      $or: [{ fromUser: req.userId }, { toUser: req.userId }],
    })
      .populate('fromUser', 'name email averageRating availabilitySlots')
      .populate('toUser',   'name email averageRating availabilitySlots')
      .sort({ createdAt: -1 });

    res.status(200).json(requests);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// PUT /api/swap/:id/accept
exports.acceptSwapRequest = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid swap ID' });
    }

    let acceptedSwap = null;

    await withTransaction(async (session) => {
      const query = SwapRequest.findById(req.params.id)
        .populate('fromUser', 'name email')
        .populate('toUser', 'name email');
      if (session) query.session(session);
      const swap = await query;

      if (!swap) {
        const err = new Error('Swap request not found');
        err.statusCode = 404;
        throw err;
      }

      if (swap.toUser._id.toString() !== req.userId.toString()) {
        const err = new Error('Not authorized to accept this request');
        err.statusCode = 403;
        throw err;
      }
      if (swap.circularExchange) {
        const err = new Error('Circular exchange legs cannot be modified directly via bilateral endpoints. Use the dedicated circular exchange endpoints.');
        err.statusCode = 409;
        throw err;
      }
      if (swap.status !== 'pending') {
        const err = new Error('Only pending requests can be accepted');
        err.statusCode = 400;
        throw err;
      }

      const fromUserId = swap.fromUser._id || swap.fromUser;
      const toUserId = swap.toUser._id || swap.toUser;

      // Layer 1: Check for existing accepted bilateral swaps involving either participant
      await assertNoAcceptedSwapConflicts({
        participantIds: [fromUserId, toUserId],
        excludeSwapId: swap._id,
        session,
      });

      // Layer 2: Acquire shared reservations for both participants atomically
      try {
        await acquireReservations({
          reservations: [
            {
              participant: fromUserId,
              exchangeType: 'bilateral',
              exchangeId: swap._id,
              skillBeingTaught: swap.offeredSkill,
            },
            {
              participant: toUserId,
              exchangeType: 'bilateral',
              exchangeId: swap._id,
              skillBeingTaught: swap.wantedSkill,
            },
          ],
          session,
        });
      } catch (resErr) {
        if (resErr.code === 'RESERVATION_CONFLICT' || resErr.status === 409 || resErr.code === 11000) {
          const err = new Error('One or more participants currently have an active exchange in progress');
          err.statusCode = 409;
          throw err;
        }
        throw resErr;
      }

      swap.status = 'accepted';
      swap.roomId = `skillswap-${swap._id}`;
      if (session) {
        await swap.save({ session });
      } else {
        await swap.save();
      }

      acceptedSwap = swap;
    });

    // Trigger Notification for the original sender (fromUser) post-commit
    await createAndEmitNotification({
      recipient: acceptedSwap.fromUser._id,
      sender: req.userId,
      type: 'SWAP_ACCEPTED',
      title: 'Swap Request Accepted! 🚀',
      message: `${acceptedSwap.toUser.name} accepted your swap request for ${acceptedSwap.offeredSkill} ⇄ ${acceptedSwap.wantedSkill}. Your private WebRTC room is ready!`,
      relatedSwap: acceptedSwap._id,
    });

    return res.status(200).json(acceptedSwap);
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ message: err.message });
    }
    if (err.code === 'RESERVATION_CONFLICT' || err.status === 409 || err.code === 11000) {
      return res.status(409).json({
        message: 'One or more participants currently have an active exchange in progress',
      });
    }
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// PUT /api/swap/:id/reject
exports.rejectSwapRequest = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid swap ID' });
    }

    const swap = await SwapRequest.findById(req.params.id)
      .populate('fromUser', 'name email')
      .populate('toUser', 'name email');

    if (!swap) return res.status(404).json({ message: 'Swap request not found' });

    if (swap.toUser._id.toString() !== req.userId.toString()) {
      return res.status(403).json({ message: 'Not authorized to reject this request' });
    }
    if (swap.circularExchange) {
      return res.status(409).json({
        message: 'Circular exchange legs cannot be modified directly via bilateral endpoints. Use the dedicated circular exchange endpoints.',
      });
    }
    if (swap.status !== 'pending') {
      return res.status(400).json({ message: 'Only pending requests can be rejected' });
    }

    swap.status = 'rejected';
    await swap.save();

    // Trigger Notification for the original sender (fromUser)
    await createAndEmitNotification({
      recipient: swap.fromUser._id,
      sender: req.userId,
      type: 'SWAP_REJECTED',
      title: 'Swap Request Declined',
      message: `${swap.toUser.name} declined your swap request for ${swap.offeredSkill} ⇄ ${swap.wantedSkill}.`,
      relatedSwap: swap._id,
    });

    res.status(200).json(swap);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// PUT /api/swap/:id/cancel  — sender can cancel a request
exports.cancelSwapRequest = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid swap ID' });
    }

    let cancelledSwap = null;

    await withTransaction(async (session) => {
      const query = SwapRequest.findById(req.params.id)
        .populate('fromUser', 'name email')
        .populate('toUser', 'name email');
      if (session) query.session(session);
      const swap = await query;

      if (!swap) {
        const err = new Error('Swap request not found');
        err.statusCode = 404;
        throw err;
      }

      if (swap.fromUser._id.toString() !== req.userId.toString()) {
        const err = new Error('Only the sender can cancel a request');
        err.statusCode = 403;
        throw err;
      }
      if (swap.circularExchange) {
        const err = new Error('Circular exchange legs cannot be modified directly via bilateral endpoints. Use the dedicated circular exchange endpoints.');
        err.statusCode = 409;
        throw err;
      }
      if (swap.status !== 'pending' && swap.status !== 'accepted') {
        const err = new Error('Only pending requests can be cancelled');
        err.statusCode = 400;
        throw err;
      }

      swap.status = 'cancelled';
      swap.cancelReason = req.body.reason || '';
      if (session) {
        await swap.save({ session });
      } else {
        await swap.save();
      }

      // Release any reservations for this swap in the same transaction
      await releaseReservations({ exchangeId: swap._id, session });

      cancelledSwap = swap;
    });

    // Trigger Notification for the target receiver (toUser) post-commit
    await createAndEmitNotification({
      recipient: cancelledSwap.toUser._id,
      sender: req.userId,
      type: 'SWAP_CANCELLED',
      title: 'Swap Request Cancelled',
      message: `${cancelledSwap.fromUser.name} cancelled the swap proposal.${cancelledSwap.cancelReason ? ` Reason: ${cancelledSwap.cancelReason}` : ''}`,
      relatedSwap: cancelledSwap._id,
    });

    return res.status(200).json(cancelledSwap);
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ message: err.message });
    }
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// PUT /api/swap/:id/complete
exports.completeSwapRequest = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid swap ID' });
    }

    let completedSwap = null;
    let currentUser = null;
    let otherUser = null;

    await withTransaction(async (session) => {
      const query = SwapRequest.findById(req.params.id)
        .populate('fromUser', 'name email')
        .populate('toUser', 'name email');
      if (session) query.session(session);
      const swap = await query;

      if (!swap) {
        const err = new Error('Swap request not found');
        err.statusCode = 404;
        throw err;
      }

      const isFromUser = swap.fromUser._id.toString() === req.userId.toString();
      const isToUser   = swap.toUser._id.toString()   === req.userId.toString();

      if (!isFromUser && !isToUser) {
        const err = new Error('Not authorized');
        err.statusCode = 403;
        throw err;
      }
      if (swap.circularExchange) {
        const err = new Error('Circular exchange legs cannot be modified directly via bilateral endpoints. Use the dedicated circular exchange endpoints.');
        err.statusCode = 409;
        throw err;
      }
      if (swap.status !== 'accepted') {
        const err = new Error('Only accepted swaps can be marked complete');
        err.statusCode = 400;
        throw err;
      }

      swap.status = 'completed';
      if (session) {
        await swap.save({ session });
      } else {
        await swap.save();
      }

      // Release reservations atomically in the same transaction
      await releaseReservations({ exchangeId: swap._id, session });

      completedSwap = swap;
      currentUser = isFromUser ? swap.fromUser : swap.toUser;
      otherUser   = isFromUser ? swap.toUser : swap.fromUser;
    });

    // Trigger Notification for the other partner post-commit
    await createAndEmitNotification({
      recipient: otherUser._id,
      sender: currentUser._id,
      type: 'SWAP_COMPLETED',
      title: 'Swap Marked as Completed! ⭐',
      message: `${currentUser.name} marked your skill session as completed. Please write a review and leave an endorsement!`,
      relatedSwap: completedSwap._id,
    });

    return res.status(200).json(completedSwap);
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ message: err.message });
    }
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// PUT /api/swap/:id/schedule
exports.scheduleSwap = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid swap ID' });
    }

    const { scheduledAt } = req.body;
    if (!scheduledAt) return res.status(400).json({ message: 'scheduledAt is required' });

    const scheduledDate = new Date(scheduledAt);
    if (isNaN(scheduledDate.getTime())) {
      return res.status(400).json({ message: 'Invalid scheduled date format' });
    }

    if (scheduledDate < new Date()) {
      return res.status(400).json({ message: 'Scheduled time must be in the future' });
    }

    const swap = await SwapRequest.findById(req.params.id)
      .populate('fromUser', 'name email')
      .populate('toUser', 'name email');

    if (!swap) return res.status(404).json({ message: 'Swap request not found' });

    const isFromUser = swap.fromUser._id.toString() === req.userId.toString();
    const isToUser   = swap.toUser._id.toString()   === req.userId.toString();

    if (!isFromUser && !isToUser) {
      return res.status(403).json({ message: 'Not authorized to schedule this swap' });
    }
    if (swap.circularExchange) {
      return res.status(409).json({
        message: 'Circular exchange legs cannot be modified directly via bilateral endpoints. Use the dedicated circular exchange endpoints.',
      });
    }
    if (swap.status !== 'accepted') {
      return res.status(400).json({ message: 'Only accepted swaps can be scheduled' });
    }

    const wasPreviouslyScheduled = !!swap.scheduledAt;
    swap.scheduledAt = scheduledDate;
    await swap.save();

    // Trigger Notification for the partner
    const currentUser = isFromUser ? swap.fromUser : swap.toUser;
    const otherUser   = isFromUser ? swap.toUser : swap.fromUser;
    const formattedDate = scheduledDate.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

    await createAndEmitNotification({
      recipient: otherUser._id,
      sender: currentUser._id,
      type: wasPreviouslyScheduled ? 'SESSION_RESCHEDULED' : 'SESSION_SCHEDULED',
      title: wasPreviouslyScheduled ? 'Session Rescheduled 📅' : 'Session Scheduled 📅',
      message: `${currentUser.name} scheduled your video session for ${formattedDate}.`,
      relatedSwap: swap._id,
    });

    res.status(200).json(swap);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};
