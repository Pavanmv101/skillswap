/**
 * Phase 6 — Advanced Skill Exchange Algorithm (Step 3)
 * models/ExchangeReservation.js
 *
 * Implements atomic participant reservations across both bilateral and circular exchanges.
 * The unique index on `participant` guarantees database-level mutual exclusion,
 * preventing any participant from holding multiple concurrent active exchanges.
 */

'use strict';

const mongoose = require('mongoose');

const exchangeReservationSchema = new mongoose.Schema(
  {
    participant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    exchangeType: {
      type: String,
      enum: ['circular', 'bilateral'],
      required: true,
    },
    exchangeId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    skillBeingTaught: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ['active'],
      default: 'active',
      required: true,
    },
  },
  { timestamps: true }
);

// Strict database mutual exclusion: a participant can hold at most ONE active reservation
exchangeReservationSchema.index({ participant: 1 }, { unique: true });
exchangeReservationSchema.index({ exchangeId: 1 });

module.exports = mongoose.model('ExchangeReservation', exchangeReservationSchema);
