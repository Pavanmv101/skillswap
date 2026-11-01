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
        'LEARNING_PLAN_CREATED',
        'MILESTONE_ASSIGNED',
        'MILESTONE_SUBMITTED',
        'MILESTONE_APPROVED',
        'MILESTONE_REVISION_REQUESTED',
        'ASSESSMENT_SUBMITTED',
        'ASSESSMENT_EVALUATED',
        'TRACK_COMPLETED',
        'CIRCULAR_SWAP_PROPOSED',
        'CIRCULAR_SWAP_ACCEPTED_PARTIAL',
        'CIRCULAR_SWAP_ACTIVATED',
        'CIRCULAR_SWAP_DECLINED',
        'CIRCULAR_SWAP_CANCELLED',
        'CIRCULAR_SWAP_COMPLETED',
        'CIRCULAR_LEG_SCHEDULE_PROPOSED',
        'CIRCULAR_LEG_SCHEDULE_CONFIRMED',
        'CIRCULAR_LEG_SCHEDULE_REJECTED',
        'CIRCULAR_LEG_SCHEDULE_RESCHEDULED',
        'CIRCULAR_LEG_TEACHER_COMPLETED',
        'CIRCULAR_LEG_COMPLETED',
        'CIRCULAR_EXCHANGE_COMPLETED',
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
    outboxEvent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'OutboxEvent',
      default: null,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
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

// Compound index for fast deterministic queries sorting newest first for a specific recipient
notificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1, _id: -1 });
notificationSchema.index({ recipient: 1, createdAt: -1, _id: -1 });

// Database-level uniqueness: guarantee at-most-one notification per outbox event
notificationSchema.index(
  { outboxEvent: 1 },
  {
    name: 'unique_notification_per_outbox_event',
    unique: true,
    partialFilterExpression: {
      outboxEvent: { $type: 'objectId' },
    },
  }
);

// Database-level uniqueness: prevent duplicate reminder notifications for the same swap and recipient across clustered instances
notificationSchema.index(
  { relatedSwap: 1, type: 1, recipient: 1 },
  {
    name: 'unique_session_reminder_per_swap',
    unique: true,
    partialFilterExpression: {
      type: 'SESSION_REMINDER',
      relatedSwap: { $type: 'objectId' },
    },
  }
);

module.exports = mongoose.model('Notification', notificationSchema);
