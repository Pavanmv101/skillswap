const Rating = require('../models/Rating');
const SwapRequest = require('../models/SwapRequest');
const User = require('../models/User');

// POST /api/rating
// Submit a rating for a completed swapRequest
exports.createRating = async (req, res) => {
  try {
    const { swapRequestId, ratee, score, comment } = req.body;

    if (!score || score < 1 || score > 5) {
      return res.status(400).json({ message: 'Score must be between 1 and 5' });
    }

    const swapRequest = await SwapRequest.findById(swapRequestId);
    if (!swapRequest) {
      return res.status(404).json({ message: 'Swap request not found' });
    }

    // Verify logged-in user is part of the swap
    if (
      swapRequest.fromUser.toString() !== req.userId &&
      swapRequest.toUser.toString() !== req.userId
    ) {
      return res.status(403).json({ message: 'Not authorized to rate this swap' });
    }

    // Prevent rating the same swap twice
    const existingRating = await Rating.findOne({ swapRequest: swapRequestId, rater: req.userId });
    if (existingRating) {
      return res.status(400).json({ message: 'You have already rated this swap' });
    }

    const rating = new Rating({
      swapRequest: swapRequestId,
      rater: req.userId,
      ratee,
      score,
      comment
    });

    await rating.save();

    // Recalculate averageRating and totalRatings on the ratee's User document
    const allRatings = await Rating.find({ ratee });
    const totalRatings = allRatings.length;
    const sumOfScores  = allRatings.reduce((sum, r) => sum + r.score, 0);

    await User.findByIdAndUpdate(ratee, {
      totalRatings,
      averageRating: sumOfScores / totalRatings
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
    const ratings = await Rating.find({ ratee: req.params.id })
      .populate('rater', 'name')
      .populate('swapRequest', 'offeredSkill wantedSkill');

    res.status(200).json(ratings);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};
