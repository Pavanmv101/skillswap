const mongoose = require('mongoose');

const ratingSchema = new mongoose.Schema(
  {
    swapRequest: { type: mongoose.Schema.Types.ObjectId, ref: 'SwapRequest', required: true },
    rater: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // who is giving the rating
    ratee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // who is being rated
    score: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, default: '' },
  },
  { timestamps: true }
);

// Compound index: guarantee a user can only rate a specific swap request once
ratingSchema.index({ swapRequest: 1, rater: 1 }, { unique: true });

module.exports = mongoose.model('Rating', ratingSchema);
