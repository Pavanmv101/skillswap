const mongoose = require('mongoose');

const skillVerificationSchema = new mongoose.Schema(
  {
    user: {
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
    category: {
      type: String,
      default: 'General',
      trim: true,
    },
    evidenceType: {
      type: String,
      enum: ['certificate', 'github', 'portfolio', 'project'],
      required: true,
    },
    evidenceUrl: {
      type: String,
      trim: true,
      default: '',
    },
    // Stored in a private server directory, never served statically without authentication
    certificateFile: {
      type: String,
      default: '',
    },
    certificateOriginalName: {
      type: String,
      default: '',
    },
    certificateMimeType: {
      type: String,
      default: '',
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ['pending', 'verified', 'rejected'],
      default: 'pending',
      index: true,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    rejectionReason: {
      type: String,
      default: '',
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for querying user's verification state per skill
skillVerificationSchema.index({ user: 1, skillName: 1 });
skillVerificationSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('SkillVerification', skillVerificationSchema);
