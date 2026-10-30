const mongoose = require('mongoose');

const endorsementSchema = new mongoose.Schema(
  {
    endorser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    skillName: {
      type: String,
      required: true,
      trim: true,
    },
    swapRequest: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SwapRequest',
      required: true,
    },
    comment: {
      type: String,
      trim: true,
      default: '',
      maxlength: 300,
    },
  },
  {
    timestamps: true,
  }
);

// Prevent duplicate endorsements from the same user for the same peer and skill
endorsementSchema.index({ endorser: 1, recipient: 1, skillName: 1 }, { unique: true });
endorsementSchema.index({ recipient: 1, skillName: 1 });

module.exports = mongoose.model('Endorsement', endorsementSchema);
