const mongoose = require('mongoose');
const SwapRequest = require('../models/SwapRequest');
const User = require('../models/User');

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

    const swap = await SwapRequest.findById(req.params.id);
    if (!swap) return res.status(404).json({ message: 'Swap request not found' });

    if (swap.toUser.toString() !== req.userId) {
      return res.status(403).json({ message: 'Not authorized to accept this request' });
    }
    if (swap.status !== 'pending') {
      return res.status(400).json({ message: 'Only pending requests can be accepted' });
    }

    swap.status = 'accepted';
    swap.roomId = `skillswap-${swap._id}`;
    await swap.save();

    res.status(200).json(swap);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// PUT /api/swap/:id/reject
exports.rejectSwapRequest = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid swap ID' });
    }

    const swap = await SwapRequest.findById(req.params.id);
    if (!swap) return res.status(404).json({ message: 'Swap request not found' });

    if (swap.toUser.toString() !== req.userId) {
      return res.status(403).json({ message: 'Not authorized to reject this request' });
    }
    if (swap.status !== 'pending') {
      return res.status(400).json({ message: 'Only pending requests can be rejected' });
    }

    swap.status = 'rejected';
    await swap.save();

    res.status(200).json(swap);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// PUT /api/swap/:id/cancel  — sender can cancel a pending request
exports.cancelSwapRequest = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid swap ID' });
    }

    const swap = await SwapRequest.findById(req.params.id);
    if (!swap) return res.status(404).json({ message: 'Swap request not found' });

    if (swap.fromUser.toString() !== req.userId) {
      return res.status(403).json({ message: 'Only the sender can cancel a request' });
    }
    if (swap.status !== 'pending') {
      return res.status(400).json({ message: 'Only pending requests can be cancelled' });
    }

    swap.status = 'cancelled';
    swap.cancelReason = req.body.reason || '';
    await swap.save();

    res.status(200).json(swap);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// PUT /api/swap/:id/complete
exports.completeSwapRequest = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid swap ID' });
    }

    const swap = await SwapRequest.findById(req.params.id);
    if (!swap) return res.status(404).json({ message: 'Swap request not found' });

    if (
      swap.fromUser.toString() !== req.userId &&
      swap.toUser.toString()   !== req.userId
    ) {
      return res.status(403).json({ message: 'Not authorized' });
    }
    if (swap.status !== 'accepted') {
      return res.status(400).json({ message: 'Only accepted swaps can be marked complete' });
    }

    swap.status = 'completed';
    await swap.save();

    res.status(200).json(swap);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
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

    const swap = await SwapRequest.findById(req.params.id);
    if (!swap) return res.status(404).json({ message: 'Swap request not found' });

    if (
      swap.fromUser.toString() !== req.userId &&
      swap.toUser.toString()   !== req.userId
    ) {
      return res.status(403).json({ message: 'Not authorized to schedule this swap' });
    }
    if (swap.status !== 'accepted') {
      return res.status(400).json({ message: 'Only accepted swaps can be scheduled' });
    }

    swap.scheduledAt = scheduledDate;
    await swap.save();

    res.status(200).json(swap);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};
