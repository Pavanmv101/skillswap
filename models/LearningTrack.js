const mongoose = require('mongoose');

const milestoneSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '', trim: true },
    sequence: { type: Number, default: 1 },
    status: {
      type: String,
      enum: ['pending', 'submitted', 'approved', 'revision_requested'],
      default: 'pending',
    },
    dueDate: { type: Date },
    completedAt: { type: Date },
    evidenceUrl: { type: String, default: '', trim: true },
    submissionNotes: { type: String, default: '', trim: true },
    instructorApprovalStatus: {
      type: String,
      enum: ['pending', 'approved', 'revision_requested'],
      default: 'pending',
    },
    feedback: { type: String, default: '', trim: true },
  },
  { timestamps: true }
);

const quizQuestionSchema = new mongoose.Schema({
  question: { type: String, required: true, trim: true },
  options: [{ type: String, required: true, trim: true }],
  correctOption: { type: Number, required: true }, // Index 0-3 (kept private on backend)
});

const quizAttemptSchema = new mongoose.Schema({
  attemptedAt: { type: Date, default: Date.now },
  selectedAnswers: [{ type: Number }],
  score: { type: Number, required: true },
  passed: { type: Boolean, required: true },
});

const assessmentSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['quiz', 'practical'],
      required: true,
    },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '', trim: true },
    passingScore: { type: Number, default: 70 }, // Percentage threshold

    // Quiz fields
    questions: [quizQuestionSchema],
    attempts: [quizAttemptSchema],

    // Practical assessment fields
    instructions: { type: String, default: '' },
    submissionText: { type: String, default: '' },
    evidenceUrl: { type: String, default: '' },
    evaluationStatus: {
      type: String,
      enum: ['not_submitted', 'submitted', 'evaluated'],
      default: 'not_submitted',
    },
    instructorFeedback: { type: String, default: '' },
    evaluatedAt: { type: Date },
    passed: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const learningTrackSchema = new mongoose.Schema(
  {
    swapRequest: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SwapRequest',
      required: true,
      index: true,
    },
    learner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    instructor: {
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
    skillCategory: {
      type: String,
      default: 'General',
      trim: true,
    },
    learningObjective: {
      type: String,
      default: '',
      trim: true,
    },
    status: {
      type: String,
      enum: ['not_started', 'in_progress', 'completed', 'paused'],
      default: 'in_progress',
      index: true,
    },
    overallProgress: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    startDate: {
      type: Date,
      default: Date.now,
    },
    targetCompletionDate: {
      type: Date,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    milestones: [milestoneSchema],
    assessments: [assessmentSchema],
  },
  { timestamps: true }
);

// One track per learner per swap request (each swap has 2 tracks: Learner A and Learner B)
learningTrackSchema.index({ swapRequest: 1, learner: 1 }, { unique: true });

module.exports = mongoose.model('LearningTrack', learningTrackSchema);
