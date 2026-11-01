/**
 * Phase 6 — Advanced Skill Exchange Algorithm (Step 3)
 * models/OutboxEvent.js
 *
 * Implements the Transactional Outbox Pattern for atomic notification persistence.
 * Events are written inside the same MongoDB transaction as state transitions and
 * dispatched asynchronously to Socket.io post-commit, guaranteeing zero ghost alerts
 * and full crash recovery.
 */

'use strict';

const mongoose = require('mongoose');

const outboxEventSchema = new mongoose.Schema(
  {
    aggregateType: {
      type: String,
      required: true,
      trim: true,
    },
    aggregateId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
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
      required: true,
      trim: true,
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
    status: {
      type: String,
      enum: ['pending', 'dispatched', 'failed'],
      default: 'pending',
      index: true,
    },
    retryCount: {
      type: Number,
      default: 0,
    },
    error: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

// High-selectivity compound indexes for pending-event retrieval and aggregate lookups
outboxEventSchema.index({ status: 1, createdAt: 1 });
outboxEventSchema.index({ aggregateType: 1, aggregateId: 1 });

module.exports = mongoose.model('OutboxEvent', outboxEventSchema);
