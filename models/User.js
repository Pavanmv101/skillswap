const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name:     { type: String, required: true, trim: true },
    email:    { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },

    bio:      { type: String, default: '', maxlength: 300 },

    // Skills the user can teach
    skillsOffered: [
      {
        skill:    { type: String, required: true, trim: true },
        category: { type: String, default: 'General' },
        level:    { type: String, enum: ['Beginner', 'Intermediate', 'Advanced'], default: 'Beginner' },
        verified: { type: Boolean, default: false },
        portfolioLink: { type: String, default: '' },
      },
    ],

    // Skills the user wants to learn
    skillsWanted: [
      {
        skill:    { type: String, required: true, trim: true },
        category: { type: String, default: 'General' },
        level:    { type: String, enum: ['Beginner', 'Intermediate', 'Advanced'] },
        priority: { type: String, enum: ['Low', 'Medium', 'High'], default: 'Medium' },
      },
    ],

    // Structured availability: array of { day, from, to }
    // e.g. [{ day: "Monday", from: "18:00", to: "21:00" }]
    availabilitySlots: [
      {
        day:  { type: String, enum: ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'] },
        from: { type: String }, // "HH:MM"
        to:   { type: String }, // "HH:MM"
      },
    ],

    // IANA timezone string (e.g. "Asia/Kolkata", "America/Los_Angeles")
    // Interprets availabilitySlots in user's local timezone.
    timezone: {
      type: String,
      default: null,
      trim: true,
      validate: {
        validator: function(v) {
          if (v === null || v === undefined || v === '') return true;
          try {
            Intl.DateTimeFormat(undefined, { timeZone: v });
            return true;
          } catch (_) {
            return false;
          }
        },
        message: props => `${props.value} is not a valid IANA timezone identifier`,
      },
    },

    // Legacy free-text availability kept for backward compatibility
    availability: { type: String, default: '' },

    credits:       { type: Number, default: 0 },
    averageRating: { type: Number, default: 0 },
    totalRatings:  { type: Number, default: 0 },

    // Role-based access control
    role:          { type: String, enum: ['student', 'admin'], default: 'student' },

    // Soft block list — user IDs this user has blocked
    blockedUsers:  [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  },
  { timestamps: true }
);

// Phase 5: indexes for recommendation candidate queries (additive – never duplicate existing)
userSchema.index({ 'skillsOffered.skill': 1 });
userSchema.index({ 'skillsWanted.skill': 1 });

module.exports = mongoose.model('User', userSchema);
