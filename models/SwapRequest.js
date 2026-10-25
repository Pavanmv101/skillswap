const mongoose = require('mongoose');

const swapRequestSchema = new mongoose.Schema(
  {
    fromUser:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    toUser:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    offeredSkill: { type: String, required: true },
    wantedSkill:  { type: String, required: true },

    status: {
      type: String,
      enum: ['pending', 'accepted', 'rejected', 'completed', 'cancelled'],
      default: 'pending',
    },

    // Set on accept — used as the Jitsi room name
    roomId: { type: String },

    // Optional scheduled session time (set by either party after acceptance)
    scheduledAt: { type: Date },

    // Cancellation reason (optional free text)
    cancelReason: { type: String, default: '' },

    // Compatibility score calculated at request-creation time
    compatibilityScore: { type: Number, default: 0 },
    compatibilityNote:  { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('SwapRequest', swapRequestSchema);
