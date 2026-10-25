const SwapRequest = require('../models/SwapRequest');

// POST /api/swap
exports.createSwapRequest = async (req, res) => {
  try {
    const { toUser, offeredSkill, wantedSkill, compatibilityScore, compatibilityNote } = req.body;

    if (!toUser || !offeredSkill || !wantedSkill) {
      return res.status(400).json({ message: 'toUser, offeredSkill and wantedSkill are required' });
    }

    if (toUser === req.userId) {
      return res.status(400).json({ message: 'You cannot swap with yourself' });
    }

    const existing = await SwapRequest.findOne({
      fromUser: req.userId,
      toUser,
      status: 'pending',
    });
    if (existing) {
      return res.status(400).json({ message: 'You already have a pending request with this user' });
    }

    const swapRequest = new SwapRequest({
      fromUser: req.userId,
      toUser,
      offeredSkill,
      wantedSkill,
      compatibilityScore: compatibilityScore || 0,
      compatibilityNote:  compatibilityNote  || '',
    });

    await swapRequest.save();
    await swapRequest.populate('fromUser', 'name email');
    await swapRequest.populate('toUser',   'name email');

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
      .populate('fromUser', 'name email averageRating')
      .populate('toUser',   'name email averageRating')
      .sort({ createdAt: -1 });

    res.status(200).json(requests);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// PUT /api/swap/:id/accept
exports.acceptSwapRequest = async (req, res) => {
  try {
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
    const { scheduledAt } = req.body;
    if (!scheduledAt) return res.status(400).json({ message: 'scheduledAt is required' });

    const swap = await SwapRequest.findById(req.params.id);
    if (!swap) return res.status(404).json({ message: 'Swap request not found' });

    if (
      swap.fromUser.toString() !== req.userId &&
      swap.toUser.toString()   !== req.userId
    ) {
      return res.status(403).json({ message: 'Not authorized' });
    }
    if (swap.status !== 'accepted') {
      return res.status(400).json({ message: 'Only accepted swaps can be scheduled' });
    }

    swap.scheduledAt = new Date(scheduledAt);
    await swap.save();

    res.status(200).json(swap);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};
