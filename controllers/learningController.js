const mongoose = require('mongoose');
const LearningTrack = require('../models/LearningTrack');
const SwapRequest = require('../models/SwapRequest');
const User = require('../models/User');
const { createAndEmitNotification } = require('../services/notificationService');

// Helper: Calculate progress percentage safely
function calculateTrackProgress(milestones) {
  if (!milestones || milestones.length === 0) return 0;
  const approvedCount = milestones.filter(m => m.status === 'approved').length;
  return Math.round((approvedCount / milestones.length) * 100);
}

// Helper: Sanitize quiz answers so learners cannot cheat by inspecting network traffic
function sanitizeTrackForLearner(trackDoc, userId) {
  const trackObj = trackDoc.toObject ? trackDoc.toObject() : { ...trackDoc };
  if (trackObj.learner?._id?.toString() === userId.toString() || trackObj.learner?.toString() === userId.toString()) {
    if (trackObj.assessments && Array.isArray(trackObj.assessments)) {
      trackObj.assessments = trackObj.assessments.map(a => {
        if (a.type === 'quiz' && a.questions) {
          a.questions = a.questions.map(q => {
            const { correctOption, ...safeQuestion } = q;
            return safeQuestion;
          });
        }
        return a;
      });
    }
  }
  return trackObj;
}

// POST /api/learning/init/:swapId
// Initializes the two reciprocal learning tracks for an accepted or completed swap
exports.initLearningPlanForSwap = async (req, res) => {
  try {
    const { swapId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(swapId)) {
      return res.status(400).json({ message: 'Invalid swap ID' });
    }

    const swap = await SwapRequest.findById(swapId)
      .populate('fromUser', 'name email skillsOffered')
      .populate('toUser', 'name email skillsOffered');

    if (!swap) {
      return res.status(404).json({ message: 'Swap request not found' });
    }

    if (swap.status !== 'accepted' && swap.status !== 'completed') {
      return res.status(400).json({ message: 'Learning plans can only be created for accepted or completed swaps' });
    }

    const isFrom = swap.fromUser._id.toString() === req.userId.toString();
    const isTo   = swap.toUser._id.toString()   === req.userId.toString();

    if (!isFrom && !isTo) {
      return res.status(403).json({ message: 'Not authorized to access learning tracks for this swap' });
    }

    // Check for existing tracks for this swap
    let existingTracks = await LearningTrack.find({ swapRequest: swapId })
      .populate('learner', 'name email')
      .populate('instructor', 'name email');

    if (existingTracks.length >= 2) {
      // Both tracks already initialized
      const sanitized = existingTracks.map(t => sanitizeTrackForLearner(t, req.userId));
      return res.status(200).json({
        message: 'Learning plan already exists',
        tracks: sanitized,
      });
    }

    const createdTracks = [];

    // Track 1: fromUser learns wantedSkill, instructor is toUser
    const track1Exists = existingTracks.find(
      t => t.learner._id.toString() === swap.fromUser._id.toString()
    );
    if (!track1Exists) {
      const fromObj = swap.fromUser.skillsOffered?.find(s => s.skill.toLowerCase() === swap.offeredSkill.toLowerCase());
      const toObj   = swap.toUser.skillsOffered?.find(s => s.skill.toLowerCase() === swap.wantedSkill.toLowerCase());

      const track1 = new LearningTrack({
        swapRequest: swapId,
        learner: swap.fromUser._id,
        instructor: swap.toUser._id,
        skillName: swap.wantedSkill,
        skillCategory: toObj?.category || 'General',
        learningObjective: `Master ${swap.wantedSkill} fundamentals and practical applications guided by ${swap.toUser.name}`,
        status: 'in_progress',
        overallProgress: 0,
        milestones: [
          {
            title: `Orientation & Fundamentals of ${swap.wantedSkill}`,
            description: `Review learning objectives, core concepts, and set up the development environment.`,
            sequence: 1,
            status: 'pending',
          },
        ],
      });
      await track1.save();
      createdTracks.push(track1);
    }

    // Track 2: toUser learns offeredSkill, instructor is fromUser
    const track2Exists = existingTracks.find(
      t => t.learner._id.toString() === swap.toUser._id.toString()
    );
    if (!track2Exists) {
      const fromObj = swap.fromUser.skillsOffered?.find(s => s.skill.toLowerCase() === swap.offeredSkill.toLowerCase());

      const track2 = new LearningTrack({
        swapRequest: swapId,
        learner: swap.toUser._id,
        instructor: swap.fromUser._id,
        skillName: swap.offeredSkill,
        skillCategory: fromObj?.category || 'General',
        learningObjective: `Learn ${swap.offeredSkill} from ${swap.fromUser.name} through peer exchange`,
        status: 'in_progress',
        overallProgress: 0,
        milestones: [
          {
            title: `Introduction & Basics of ${swap.offeredSkill}`,
            description: `Understand the core syntax, toolchains, and initial problem-solving approaches.`,
            sequence: 1,
            status: 'pending',
          },
        ],
      });
      await track2.save();
      createdTracks.push(track2);
    }

    // Notify partner that learning plan has been initialized
    const partnerId = isFrom ? swap.toUser._id : swap.fromUser._id;
    await createAndEmitNotification({
      recipient: partnerId,
      sender: req.userId,
      type: 'LEARNING_PLAN_CREATED',
      title: 'Learning Plan Initialized! 🎯',
      message: `Your reciprocal peer learning roadmaps for ${swap.offeredSkill} ⇄ ${swap.wantedSkill} are ready.`,
      relatedSwap: swap._id,
    });

    const allTracks = await LearningTrack.find({ swapRequest: swapId })
      .populate('learner', 'name email')
      .populate('instructor', 'name email');

    const sanitized = allTracks.map(t => sanitizeTrackForLearner(t, req.userId));

    res.status(201).json({
      message: 'Learning plans initialized successfully',
      tracks: sanitized,
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET /api/learning/dashboard
// Returns user learning tracks (learner), teaching tracks (instructor), and summary metrics
exports.getLearningDashboard = async (req, res) => {
  try {
    const [learningTracks, teachingTracks] = await Promise.all([
      LearningTrack.find({ learner: req.userId })
        .populate('instructor', 'name email bio averageRating')
        .populate('swapRequest', 'offeredSkill wantedSkill status scheduledAt')
        .sort({ updatedAt: -1 }),
      LearningTrack.find({ instructor: req.userId })
        .populate('learner', 'name email bio averageRating')
        .populate('swapRequest', 'offeredSkill wantedSkill status scheduledAt')
        .sort({ updatedAt: -1 }),
    ]);

    // Compute metrics
    const totalLearning = learningTracks.length;
    const totalTeaching = teachingTracks.length;
    const completedTracks = learningTracks.filter(t => t.status === 'completed').length;

    let totalProgressSum = 0;
    learningTracks.forEach(t => {
      totalProgressSum += (t.overallProgress || 0);
    });
    const avgProgress = totalLearning > 0 ? Math.round(totalProgressSum / totalLearning) : 0;

    // Upcoming milestone deadlines from my learning tracks
    const upcomingMilestones = [];
    learningTracks.forEach(t => {
      (t.milestones || []).forEach(m => {
        if (m.dueDate && m.status !== 'approved') {
          upcomingMilestones.push({
            trackId: t._id,
            skillName: t.skillName,
            instructorName: t.instructor?.name,
            milestoneId: m._id,
            title: m.title,
            dueDate: m.dueDate,
            status: m.status,
          });
        }
      });
    });
    upcomingMilestones.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

    // Sanitize quiz correct answers for learning tracks
    const sanitizedLearning = learningTracks.map(t => sanitizeTrackForLearner(t, req.userId));

    res.status(200).json({
      stats: {
        totalLearning,
        totalTeaching,
        completedTracks,
        avgProgress,
        upcomingCount: upcomingMilestones.length,
      },
      learning: sanitizedLearning,
      teaching: teachingTracks,
      upcomingMilestones: upcomingMilestones.slice(0, 5),
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET /api/learning/track/:trackId
// Retrieves details of a specific track with authorization check
exports.getLearningTrack = async (req, res) => {
  try {
    const { trackId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(trackId)) {
      return res.status(400).json({ message: 'Invalid track ID' });
    }

    const track = await LearningTrack.findById(trackId)
      .populate('learner', 'name email bio averageRating')
      .populate('instructor', 'name email bio averageRating')
      .populate('swapRequest', 'offeredSkill wantedSkill status scheduledAt roomId');

    if (!track) {
      return res.status(404).json({ message: 'Learning track not found' });
    }

    const isLearner    = track.learner._id.toString() === req.userId.toString();
    const isInstructor = track.instructor._id.toString() === req.userId.toString();

    if (!isLearner && !isInstructor) {
      return res.status(403).json({ message: 'Access denied: You are not a participant in this learning track' });
    }

    // Sanitize quiz questions if learner is requesting
    const sanitized = sanitizeTrackForLearner(track, req.userId);

    res.status(200).json(sanitized);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET /api/learning/swap/:swapId
exports.getTracksForSwap = async (req, res) => {
  try {
    const { swapId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(swapId)) {
      return res.status(400).json({ message: 'Invalid swap ID' });
    }

    const tracks = await LearningTrack.find({ swapRequest: swapId })
      .populate('learner', 'name email')
      .populate('instructor', 'name email');

    // Authorize participant
    const isParticipant = tracks.some(
      t => t.learner._id.toString() === req.userId.toString() || t.instructor._id.toString() === req.userId.toString()
    );

    if (tracks.length > 0 && !isParticipant) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const sanitized = tracks.map(t => sanitizeTrackForLearner(t, req.userId));
    res.status(200).json(sanitized);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// POST /api/learning/track/:trackId/milestones
// Instructor creates a new milestone
exports.createMilestone = async (req, res) => {
  try {
    const { trackId } = req.params;
    const { title, description, sequence, dueDate } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ message: 'Milestone title is required' });
    }

    const track = await LearningTrack.findById(trackId);
    if (!track) return res.status(404).json({ message: 'Learning track not found' });

    if (track.instructor.toString() !== req.userId.toString()) {
      return res.status(403).json({ message: 'Only the instructor can create learning milestones' });
    }

    const nextSeq = sequence || (track.milestones.length + 1);

    track.milestones.push({
      title: title.trim(),
      description: (description || '').trim(),
      sequence: nextSeq,
      dueDate: dueDate ? new Date(dueDate) : null,
      status: 'pending',
    });

    track.overallProgress = calculateTrackProgress(track.milestones);
    if (track.overallProgress < 100 && track.status === 'completed') {
      track.status = 'in_progress';
      track.completedAt = null;
    }

    await track.save();

    // Notify learner
    await createAndEmitNotification({
      recipient: track.learner,
      sender: req.userId,
      type: 'MILESTONE_ASSIGNED',
      title: 'New Milestone Assigned 📌',
      message: `Your instructor added milestone "${title.trim()}" to your ${track.skillName} roadmap.`,
      relatedSwap: track.swapRequest,
    });

    const populated = await LearningTrack.findById(trackId)
      .populate('learner', 'name email')
      .populate('instructor', 'name email');

    res.status(201).json(populated);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// PUT /api/learning/track/:trackId/milestones/:milestoneId
// Instructor edits a milestone
exports.updateMilestone = async (req, res) => {
  try {
    const { trackId, milestoneId } = req.params;
    const { title, description, sequence, dueDate } = req.body;

    const track = await LearningTrack.findById(trackId);
    if (!track) return res.status(404).json({ message: 'Learning track not found' });

    if (track.instructor.toString() !== req.userId.toString()) {
      return res.status(403).json({ message: 'Only the instructor can update milestone details' });
    }

    const milestone = track.milestones.id(milestoneId);
    if (!milestone) return res.status(404).json({ message: 'Milestone not found' });

    if (title) milestone.title = title.trim();
    if (description !== undefined) milestone.description = description.trim();
    if (sequence !== undefined) milestone.sequence = sequence;
    if (dueDate !== undefined) milestone.dueDate = dueDate ? new Date(dueDate) : null;

    await track.save();
    res.status(200).json(track);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// DELETE /api/learning/track/:trackId/milestones/:milestoneId
// Instructor deletes a milestone
exports.deleteMilestone = async (req, res) => {
  try {
    const { trackId, milestoneId } = req.params;

    const track = await LearningTrack.findById(trackId);
    if (!track) return res.status(404).json({ message: 'Learning track not found' });

    if (track.instructor.toString() !== req.userId.toString()) {
      return res.status(403).json({ message: 'Only the instructor can delete milestones' });
    }

    track.milestones.pull({ _id: milestoneId });
    track.overallProgress = calculateTrackProgress(track.milestones);

    if (track.milestones.length > 0 && track.overallProgress === 100) {
      track.status = 'completed';
      track.completedAt = track.completedAt || new Date();
    } else if (track.status === 'completed' && track.overallProgress < 100) {
      track.status = 'in_progress';
      track.completedAt = null;
    }

    await track.save();
    res.status(200).json(track);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// POST /api/learning/track/:trackId/milestones/:milestoneId/submit
// Learner submits a milestone with optional evidence URL and notes
exports.submitMilestone = async (req, res) => {
  try {
    const { trackId, milestoneId } = req.params;
    const { evidenceUrl, submissionNotes } = req.body;

    const track = await LearningTrack.findById(trackId);
    if (!track) return res.status(404).json({ message: 'Learning track not found' });

    if (track.learner.toString() !== req.userId.toString()) {
      return res.status(403).json({ message: 'Only the assigned learner can submit this milestone' });
    }

    const milestone = track.milestones.id(milestoneId);
    if (!milestone) return res.status(404).json({ message: 'Milestone not found' });

    // Validate evidenceUrl if provided
    let validatedUrl = '';
    if (evidenceUrl && evidenceUrl.trim()) {
      try {
        const u = new URL(evidenceUrl.trim());
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
          return res.status(400).json({ message: 'Evidence URL must start with http:// or https://' });
        }
        validatedUrl = u.toString();
      } catch (e) {
        return res.status(400).json({ message: 'Invalid URL format for evidence' });
      }
    }

    milestone.status = 'submitted';
    milestone.evidenceUrl = validatedUrl || milestone.evidenceUrl;
    milestone.submissionNotes = (submissionNotes || '').trim();
    milestone.instructorApprovalStatus = 'pending';

    await track.save();

    // Notify instructor
    await createAndEmitNotification({
      recipient: track.instructor,
      sender: req.userId,
      type: 'MILESTONE_SUBMITTED',
      title: 'Milestone Submitted for Review 📝',
      message: `Your learner submitted "${milestone.title}" for review in ${track.skillName}.`,
      relatedSwap: track.swapRequest,
    });

    const sanitized = sanitizeTrackForLearner(track, req.userId);
    res.status(200).json(sanitized);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// POST /api/learning/track/:trackId/milestones/:milestoneId/review
// Instructor approves or requests revision with feedback
exports.reviewMilestone = async (req, res) => {
  try {
    const { trackId, milestoneId } = req.params;
    const { action, feedback } = req.body; // action: 'approve' | 'revision_requested'

    if (!['approve', 'revision_requested'].includes(action)) {
      return res.status(400).json({ message: 'Action must be "approve" or "revision_requested"' });
    }

    const track = await LearningTrack.findById(trackId);
    if (!track) return res.status(404).json({ message: 'Learning track not found' });

    // Security: Only instructor can approve/review. Learner strictly cannot approve their own milestone.
    if (track.instructor.toString() !== req.userId.toString()) {
      return res.status(403).json({ message: 'Security violation: Only the instructor can evaluate and approve milestones' });
    }

    const milestone = track.milestones.id(milestoneId);
    if (!milestone) return res.status(404).json({ message: 'Milestone not found' });

    if (action === 'approve') {
      milestone.status = 'approved';
      milestone.instructorApprovalStatus = 'approved';
      milestone.completedAt = new Date();
      milestone.feedback = (feedback || 'Milestone approved! Great work.').trim();

      // Recalculate track progress automatically
      track.overallProgress = calculateTrackProgress(track.milestones);

      const allApproved = track.milestones.length > 0 && track.milestones.every(m => m.status === 'approved');
      if (allApproved) {
        track.status = 'completed';
        track.completedAt = new Date();

        // Notify learner that track is complete
        await createAndEmitNotification({
          recipient: track.learner,
          sender: req.userId,
          type: 'TRACK_COMPLETED',
          title: 'Learning Track Completed! 🏆',
          message: `Congratulations! You have completed all milestones for "${track.skillName}"!`,
          relatedSwap: track.swapRequest,
        });
      }

      await createAndEmitNotification({
        recipient: track.learner,
        sender: req.userId,
        type: 'MILESTONE_APPROVED',
        title: 'Milestone Approved! ✅',
        message: `Your milestone "${milestone.title}" was approved by your instructor (${track.overallProgress}% complete).`,
        relatedSwap: track.swapRequest,
      });
    } else {
      // revision_requested
      milestone.status = 'revision_requested';
      milestone.instructorApprovalStatus = 'revision_requested';
      milestone.feedback = (feedback || 'Please revise your submission based on instructor notes.').trim();

      // Recalculate track progress
      track.overallProgress = calculateTrackProgress(track.milestones);
      if (track.status === 'completed') {
        track.status = 'in_progress';
        track.completedAt = null;
      }

      await createAndEmitNotification({
        recipient: track.learner,
        sender: req.userId,
        type: 'MILESTONE_REVISION_REQUESTED',
        title: 'Milestone Revision Requested ⚠️',
        message: `Your instructor requested revisions on "${milestone.title}". Feedback: "${milestone.feedback}"`,
        relatedSwap: track.swapRequest,
      });
    }

    await track.save();
    res.status(200).json(track);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// POST /api/learning/track/:trackId/assessments
// Instructor creates an assessment (quiz or practical task)
exports.createAssessment = async (req, res) => {
  try {
    const { trackId } = req.params;
    const { type, title, description, passingScore, questions, instructions } = req.body;

    if (!type || !['quiz', 'practical'].includes(type)) {
      return res.status(400).json({ message: 'Assessment type must be "quiz" or "practical"' });
    }

    if (!title || !title.trim()) {
      return res.status(400).json({ message: 'Assessment title is required' });
    }

    const track = await LearningTrack.findById(trackId);
    if (!track) return res.status(404).json({ message: 'Learning track not found' });

    if (track.instructor.toString() !== req.userId.toString()) {
      return res.status(403).json({ message: 'Only the instructor can create assessments' });
    }

    const newAssessment = {
      type,
      title: title.trim(),
      description: (description || '').trim(),
      passingScore: Number(passingScore) || 70,
    };

    if (type === 'quiz') {
      if (!questions || !Array.isArray(questions) || questions.length === 0) {
        return res.status(400).json({ message: 'At least one multiple choice question is required for a quiz' });
      }

      for (const q of questions) {
        if (!q.question || !q.options || q.options.length < 2 || q.correctOption === undefined) {
          return res.status(400).json({
            message: 'Each question requires question text, at least two options, and a valid correctOption index',
          });
        }
      }
      newAssessment.questions = questions;
      newAssessment.attempts = [];
    } else {
      // practical
      newAssessment.instructions = (instructions || '').trim();
      newAssessment.evaluationStatus = 'not_submitted';
    }

    track.assessments.push(newAssessment);
    await track.save();

    res.status(201).json(track);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// POST /api/learning/track/:trackId/assessments/:assessmentId/quiz-submit
// Learner submits a quiz attempt; score is calculated securely on backend
exports.submitQuizAssessment = async (req, res) => {
  try {
    const { trackId, assessmentId } = req.params;
    const { answers } = req.body; // array of selected indices, e.g. [0, 2, 1]

    if (!answers || !Array.isArray(answers)) {
      return res.status(400).json({ message: 'Answers array is required' });
    }

    const track = await LearningTrack.findById(trackId);
    if (!track) return res.status(404).json({ message: 'Learning track not found' });

    if (track.learner.toString() !== req.userId.toString()) {
      return res.status(403).json({ message: 'Only the assigned learner can take this quiz' });
    }

    const assessment = track.assessments.id(assessmentId);
    if (!assessment || assessment.type !== 'quiz') {
      return res.status(404).json({ message: 'Quiz assessment not found' });
    }

    if (answers.length !== assessment.questions.length) {
      return res.status(400).json({
        message: `Expected ${assessment.questions.length} answers, received ${answers.length}`,
      });
    }

    // Backend grading
    let correctCount = 0;
    assessment.questions.forEach((q, i) => {
      if (answers[i] === q.correctOption) {
        correctCount++;
      }
    });

    const score = Math.round((correctCount / assessment.questions.length) * 100);
    const passed = score >= (assessment.passingScore || 70);

    const attemptRecord = {
      attemptedAt: new Date(),
      selectedAnswers: answers,
      score,
      passed,
    };

    assessment.attempts.push(attemptRecord);
    await track.save();

    // Notify instructor
    await createAndEmitNotification({
      recipient: track.instructor,
      sender: req.userId,
      type: 'ASSESSMENT_SUBMITTED',
      title: 'Quiz Assessment Completed 📊',
      message: `Your learner completed quiz "${assessment.title}" with a score of ${score}% (${passed ? 'PASSED' : 'NEEDS PRACTICE'}).`,
      relatedSwap: track.swapRequest,
    });

    res.status(200).json({
      score,
      passed,
      passingScore: assessment.passingScore,
      correctCount,
      totalQuestions: assessment.questions.length,
      attemptsCount: assessment.attempts.length,
      attempt: attemptRecord,
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// POST /api/learning/track/:trackId/assessments/:assessmentId/practical-submit
// Learner submits practical task
exports.submitPracticalAssessment = async (req, res) => {
  try {
    const { trackId, assessmentId } = req.params;
    const { submissionText, evidenceUrl } = req.body;

    if (!submissionText || !submissionText.trim()) {
      return res.status(400).json({ message: 'Project submission description is required' });
    }

    const track = await LearningTrack.findById(trackId);
    if (!track) return res.status(404).json({ message: 'Learning track not found' });

    if (track.learner.toString() !== req.userId.toString()) {
      return res.status(403).json({ message: 'Only the assigned learner can submit this task' });
    }

    const assessment = track.assessments.id(assessmentId);
    if (!assessment || assessment.type !== 'practical') {
      return res.status(404).json({ message: 'Practical assessment not found' });
    }

    let validatedUrl = '';
    if (evidenceUrl && evidenceUrl.trim()) {
      try {
        const u = new URL(evidenceUrl.trim());
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
          return res.status(400).json({ message: 'Evidence URL must start with http:// or https://' });
        }
        validatedUrl = u.toString();
      } catch (e) {
        return res.status(400).json({ message: 'Invalid URL format' });
      }
    }

    assessment.submissionText = submissionText.trim();
    assessment.evidenceUrl = validatedUrl || assessment.evidenceUrl;
    assessment.evaluationStatus = 'submitted';

    await track.save();

    // Notify instructor
    await createAndEmitNotification({
      recipient: track.instructor,
      sender: req.userId,
      type: 'ASSESSMENT_SUBMITTED',
      title: 'Practical Project Submitted 💻',
      message: `Your learner submitted practical task "${assessment.title}" for review.`,
      relatedSwap: track.swapRequest,
    });

    res.status(200).json({
      message: 'Practical task submitted successfully',
      assessment,
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// POST /api/learning/track/:trackId/assessments/:assessmentId/practical-evaluate
// Instructor reviews practical task
exports.evaluatePracticalAssessment = async (req, res) => {
  try {
    const { trackId, assessmentId } = req.params;
    const { passed, feedback } = req.body;

    const track = await LearningTrack.findById(trackId);
    if (!track) return res.status(404).json({ message: 'Learning track not found' });

    if (track.instructor.toString() !== req.userId.toString()) {
      return res.status(403).json({ message: 'Only the instructor can evaluate practical assessments' });
    }

    const assessment = track.assessments.id(assessmentId);
    if (!assessment || assessment.type !== 'practical') {
      return res.status(404).json({ message: 'Practical assessment not found' });
    }

    assessment.passed = Boolean(passed);
    assessment.instructorFeedback = (feedback || '').trim();
    assessment.evaluationStatus = 'evaluated';
    assessment.evaluatedAt = new Date();

    await track.save();

    // Notify learner
    await createAndEmitNotification({
      recipient: track.learner,
      sender: req.userId,
      type: 'ASSESSMENT_EVALUATED',
      title: 'Practical Task Evaluated 📋',
      message: `Your instructor evaluated "${assessment.title}": ${assessment.passed ? 'PASSED' : 'NEEDS REVISION'}. Feedback: "${assessment.instructorFeedback}"`,
      relatedSwap: track.swapRequest,
    });

    res.status(200).json({
      message: 'Assessment evaluated successfully',
      assessment,
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET /api/learning/achievements/:userId
// Publicly visible achievements: skills successfully completed by a learner
exports.getUserLearningAchievements = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: 'Invalid user ID' });
    }

    const completed = await LearningTrack.find({ learner: userId, status: 'completed' })
      .select('skillName skillCategory overallProgress completedAt instructor')
      .populate('instructor', 'name')
      .sort({ completedAt: -1 });

    res.status(200).json(completed);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};
