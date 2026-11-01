/**
 * Phase 6 — Advanced Skill Exchange Algorithm (Step 3)
 * models/CircularExchange.js
 *
 * Implements the core coordination model for Circular Three-Way Skill Exchanges.
 * Enforces strict graph-theoretic invariants (Hamiltonian 3-cycle, degree constraints,
 * zero self-loops, zero 2-cycles) and partial unique indexing for proposed and active records.
 */

'use strict';

const mongoose = require('mongoose');
const crypto   = require('crypto');

// ─── Child Leg Schema ─────────────────────────────────────────────────────────

const circularLegSchema = new mongoose.Schema(
  {
    legIndex: {
      type: Number,
      required: true,
      min: 0,
      max: 2,
    },
    teacher: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    learner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    skill: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      default: 'General',
      trim: true,
    },
    teacherLevel: {
      type: String,
      enum: ['Beginner', 'Intermediate', 'Advanced'],
      default: 'Beginner',
    },
    learnerLevel: {
      type: String,
      enum: ['Beginner', 'Intermediate', 'Advanced'],
      default: null,
    },
    status: {
      type: String,
      enum: ['pending', 'active', 'scheduled', 'teacher_completed', 'completed', 'disputed', 'cancelled'],
      default: 'pending',
    },
    scheduledAt: {
      type: Date,
      default: null,
    },
    roomId: {
      type: String,
      default: null,
    },
    teacherCompletedAt: {
      type: Date,
      default: null,
    },
    teacherCompletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    learnerConfirmedAt: {
      type: Date,
      default: null,
    },
    learnerConfirmedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    completionHistory: [
      {
        status: {
          type: String,
          enum: ['teacher_completed', 'completed'],
          required: true,
        },
        actionBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          required: true,
        },
        actionAt: {
          type: Date,
          default: Date.now,
        },
        notes: {
          type: String,
          default: '',
          maxlength: 500,
          trim: true,
        },
      },
    ],
    swapRequest: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SwapRequest',
      default: null,
    },
    scheduleVersion: {
      type: Number,
      default: 0,
    },
    scheduleProposal: {
      proposalId: {
        type: String,
        default: null,
      },
      proposedTime: {
        type: Date,
        default: null,
      },
      proposedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null,
      },
      proposedAt: {
        type: Date,
        default: null,
      },
      status: {
        type: String,
        enum: ['none', 'pending_confirmation', 'confirmed', 'rejected'],
        default: 'none',
      },
      rejectionReason: {
        type: String,
        default: '',
        maxlength: 500,
        trim: true,
      },
      respondedAt: {
        type: Date,
        default: null,
      },
    },
    scheduleHistory: [
      {
        proposalId: {
          type: String,
          default: null,
        },
        scheduledTime: {
          type: Date,
          required: true,
        },
        proposedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          required: true,
        },
        proposedAt: {
          type: Date,
          default: Date.now,
        },
        status: {
          type: String,
          enum: ['confirmed', 'rejected', 'superseded'],
          required: true,
        },
        actionBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          default: null,
        },
        actionAt: {
          type: Date,
          default: Date.now,
        },
        notes: {
          type: String,
          default: '',
          maxlength: 500,
          trim: true,
        },
      },
    ],
  },
  { _id: true, timestamps: true }
);

// ─── Participant Acceptance Subdocument Schema ────────────────────────────────

const circularParticipantSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    hasAccepted: {
      type: Boolean,
      default: false,
    },
    acceptedAt: {
      type: Date,
      default: null,
    },
  },
  { _id: false }
);

// ─── Parent Circular Exchange Schema ──────────────────────────────────────────

const circularExchangeSchema = new mongoose.Schema(
  {
    initiator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    // Exactly 3 unique participants
    participants: {
      type: [circularParticipantSchema],
      required: true,
      validate: {
        validator: function (val) {
          if (!Array.isArray(val) || val.length !== 3) return false;
          const ids = val.map(p => p.user?.toString());
          return new Set(ids).size === 3;
        },
        message: 'Circular exchange must contain exactly three distinct participants',
      },
    },

    // Exactly 3 directed teaching legs
    legs: {
      type: [circularLegSchema],
      required: true,
      validate: {
        validator: function (val) {
          return Array.isArray(val) && val.length === 3;
        },
        message: 'Circular exchange must contain exactly three directed legs',
      },
    },

    // Rotation-invariant canonical cycle hash
    canonicalCycleHash: {
      type: String,
      required: true,
      index: true,
    },

    // Parent lifecycle state machine
    status: {
      type: String,
      enum: ['proposed', 'active', 'completed', 'cancelled', 'expired'],
      default: 'proposed',
      index: true,
    },

    // Overall quality score [0, 100]
    cycleScore: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
    },

    // Explicit TTL timestamp for lazy and sweeper transitions (NEVER a MongoDB TTL delete index)
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },

    cancelReason: {
      type: String,
      default: '',
      trim: true,
    },

    cancelledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    activatedAt: {
      type: Date,
      default: null,
    },

    completedAt: {
      type: Date,
      default: null,
    },

    completedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    finalizationHistory: [
      {
        finalizedAt: {
          type: Date,
          default: Date.now,
        },
        actionBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          default: null,
        },
        legs: [
          {
            legIndex: Number,
            teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
            learner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
            skill: String,
            swapRequest: { type: mongoose.Schema.Types.ObjectId, ref: 'SwapRequest' },
            teacherCompletedAt: Date,
            learnerConfirmedAt: Date,
            completedAt: Date,
          },
        ],
        notes: {
          type: String,
          default: '',
          maxlength: 500,
          trim: true,
        },
      },
    ],
  },
  { timestamps: true }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────

// Partial unique index: prevents duplicate proposed or active cycles for identical directed loop
circularExchangeSchema.index(
  { canonicalCycleHash: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: ['proposed', 'active'] },
    },
    name: 'unique_active_or_proposed_cycle_hash',
  }
);

// Compound queries for participant feeds and expiration sweepers
circularExchangeSchema.index({ 'participants.user': 1, status: 1 });
circularExchangeSchema.index({ status: 1, expiresAt: 1 });

// ─── Static Graph & Canonicalization Helpers ──────────────────────────────────

/**
 * Validates the directed cycle structure regardless of leg array ordering,
 * and reconstructs the contiguous directed Hamiltonian cycle starting from
 * the lexicographically minimum teacher ID.
 *
 * @param {Array<string|mongoose.Types.ObjectId>} participantIds
 * @param {Array<{ teacher: any, learner: any, skill: string }>} legs
 * @returns {{ valid: boolean, canonicalCycleHash: string, orderedLegs: Array }}
 */
circularExchangeSchema.statics.validateAndCanonicalize = function (participantIds = [], legs = []) {
  if (!Array.isArray(participantIds) || participantIds.length !== 3) {
    throw new Error('Cycle must contain exactly 3 participants');
  }

  const pSet = new Set(participantIds.map(p => (p.user ? p.user.toString() : p.toString())));
  if (pSet.size !== 3) {
    throw new Error('All 3 participants must be distinct users');
  }

  if (!Array.isArray(legs) || legs.length !== 3) {
    throw new Error('Cycle must contain exactly 3 legs');
  }

  // 1. Build teacher adjacency map: teacherId -> { learner, skill, legObj }
  const teacherMap = new Map();
  const learnerSet = new Set();

  for (const leg of legs) {
    const t = (leg.teacher?._id || leg.teacher).toString();
    const l = (leg.learner?._id || leg.learner).toString();
    const s = (leg.skill || '').trim().toLowerCase();

    if (!s) {
      throw new Error('Leg skill is required');
    }

    if (t === l) {
      throw new Error('Self-loops are forbidden');
    }

    if (!pSet.has(t) || !pSet.has(l)) {
      throw new Error('Leg participant is not in cycle participant list');
    }

    if (teacherMap.has(t)) {
      throw new Error('Each participant can only teach in exactly one leg');
    }

    teacherMap.set(t, { learner: l, skill: s, rawLeg: leg });
    learnerSet.add(l);
  }

  if (learnerSet.size !== 3) {
    throw new Error('Each participant must learn in exactly one leg');
  }

  // 2. Prevent bilateral 2-cycles (A -> B and B -> A)
  for (const [t, { learner: l }] of teacherMap.entries()) {
    if (teacherMap.get(l)?.learner === t) {
      throw new Error('Bilateral 2-cycles are forbidden in circular exchange');
    }
  }

  // 3. Find the lexicographically minimum teacher among the 3 distinct IDs
  const allTeachers = [...teacherMap.keys()].sort();
  const minTeacher = allTeachers[0];

  // 4. Trace the continuous directed cycle starting from minTeacher
  const orderedLegs = [];
  let currentTeacher = minTeacher;

  for (let step = 0; step < 3; step++) {
    const edge = teacherMap.get(currentTeacher);
    if (!edge) {
      throw new Error('Disconnected directed path');
    }
    orderedLegs.push(edge);
    currentTeacher = edge.learner;
  }

  // 5. Verify the path closed back to minTeacher
  if (currentTeacher !== minTeacher) {
    throw new Error('Legs do not form a closed 3-way circular loop');
  }

  // 6. Serialize directed edges to unambiguous canonical JSON string over ordered tuples
  // Tuples format: [[teacherId, normalizedSkill, learnerId], ...]
  const canonicalTuples = orderedLegs.map(e => [
    (e.rawLeg.teacher?._id || e.rawLeg.teacher).toString(),
    e.skill,
    e.learner.toString(),
  ]);
  const canonicalString = JSON.stringify(canonicalTuples);

  const canonicalCycleHash = crypto.createHash('sha256').update(canonicalString).digest('hex');

  return {
    valid: true,
    canonicalCycleHash,
    canonicalString,
    orderedLegs: orderedLegs.map(e => e.rawLeg),
  };
};

// ─── Pre-Validate Hook ────────────────────────────────────────────────────────

circularExchangeSchema.pre('validate', function () {
  if (this.participants && this.legs && this.legs.length === 3 && this.participants.length === 3) {
    const pIds = this.participants.map(p => p.user);
    const result = circularExchangeSchema.statics.validateAndCanonicalize(pIds, this.legs);
    if (!this.canonicalCycleHash) {
      this.canonicalCycleHash = result.canonicalCycleHash;
    }
  }
});

module.exports = mongoose.model('CircularExchange', circularExchangeSchema);
