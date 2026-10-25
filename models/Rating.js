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

module.exports = mongoose.model('Rating', ratingSchema);
