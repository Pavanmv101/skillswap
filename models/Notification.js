const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    type: {
      type: String,
      enum: [
        'SWAP_REQUEST',
        'SWAP_ACCEPTED',
        'SWAP_REJECTED',
        'SWAP_CANCELLED',
        'SWAP_COMPLETED',
        'SESSION_SCHEDULED',
        'SESSION_RESCHEDULED',
        'SESSION_REMINDER',
        'VERIFICATION_SUBMITTED',
        'VERIFICATION_APPROVED',
        'VERIFICATION_REJECTED',
        'ENDORSEMENT_RECEIVED',
      ],
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    relatedSwap: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SwapRequest',
      default: null,
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for fast queries sorting newest first for a specific recipient
notificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, createdAt: -1 });

// Prevent duplicate reminder notifications for the same swap and recipient
notificationSchema.index(
  { relatedSwap: 1, type: 1, recipient: 1 },
  { sparse: true }
);

module.exports = mongoose.model('Notification', notificationSchema);
