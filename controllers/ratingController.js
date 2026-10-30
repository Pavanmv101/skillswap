const mongoose = require('mongoose');
const Rating = require('../models/Rating');
const SwapRequest = require('../models/SwapRequest');
const User = require('../models/User');

// POST /api/rating
// Submit a rating for a completed swapRequest
exports.createRating = async (req, res) => {
  try {
    const { swapRequestId, ratee, score, comment } = req.body;

    const numericScore = Number(score);
    if (!numericScore || numericScore < 1 || numericScore > 5 || !Number.isInteger(numericScore)) {
      return res.status(400).json({ message: 'Score must be an integer between 1 and 5' });
    }

    if (!mongoose.Types.ObjectId.isValid(swapRequestId) || !mongoose.Types.ObjectId.isValid(ratee)) {
      return res.status(400).json({ message: 'Invalid swapRequestId or ratee ID' });
    }

    if (ratee.toString() === req.userId.toString()) {
      return res.status(400).json({ message: 'You cannot rate yourself' });
    }

    const swapRequest = await SwapRequest.findById(swapRequestId);
    if (!swapRequest) {
      return res.status(404).json({ message: 'Swap request not found' });
    }

    // Only completed swaps can be rated
    if (swapRequest.status !== 'completed') {
      return res.status(400).json({ message: 'Only completed swaps can be rated' });
    }

    // Verify logged-in user is part of the swap
    const isFromUser = swapRequest.fromUser.toString() === req.userId.toString();
    const isToUser   = swapRequest.toUser.toString() === req.userId.toString();

    if (!isFromUser && !isToUser) {
      return res.status(403).json({ message: 'Not authorized to rate this swap' });
    }

    // Verify ratee is the OTHER party in the swap
    const expectedRatee = isFromUser ? swapRequest.toUser.toString() : swapRequest.fromUser.toString();
    if (ratee.toString() !== expectedRatee) {
      return res.status(400).json({ message: 'Ratee must be your partner in this swap' });
    }

    // Prevent rating the same swap twice by the same rater
    const existingRating = await Rating.findOne({ swapRequest: swapRequestId, rater: req.userId });
    if (existingRating) {
      return res.status(400).json({ message: 'You have already rated this swap' });
    }

    const rating = new Rating({
      swapRequest: swapRequestId,
      rater: req.userId,
      ratee,
      score: numericScore,
      comment: (comment || '').trim(),
    });

    await rating.save();

    // Recalculate averageRating and totalRatings on the ratee's User document
    const allRatings = await Rating.find({ ratee });
    const totalRatings = allRatings.length;
    const sumOfScores  = allRatings.reduce((sum, r) => sum + r.score, 0);

    await User.findByIdAndUpdate(ratee, {
      totalRatings,
      averageRating: Number((sumOfScores / totalRatings).toFixed(2)),
    });

    res.status(201).json(rating);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET /api/rating/user/:id
// Get all ratings for a specific user (public)
exports.getUserRatings = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid user ID' });
    }

    const ratings = await Rating.find({ ratee: req.params.id })
      .populate('rater', 'name')
      .populate('swapRequest', 'offeredSkill wantedSkill')
      .sort({ createdAt: -1 });

    res.status(200).json(ratings);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};
