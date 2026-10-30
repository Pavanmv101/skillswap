const express = require('express');
const router = express.Router();
const protect = require('../middleware/auth');
const {
  initLearningPlanForSwap,
  getLearningDashboard,
  getLearningTrack,
  getTracksForSwap,
  createMilestone,
  updateMilestone,
  deleteMilestone,
  submitMilestone,
  reviewMilestone,
  createAssessment,
  submitQuizAssessment,
  submitPracticalAssessment,
  evaluatePracticalAssessment,
  getUserLearningAchievements,
} = require('../controllers/learningController');

// All learning routes require JWT authentication
router.post('/init/:swapId', protect, initLearningPlanForSwap);
router.get('/dashboard',     protect, getLearningDashboard);
router.get('/achievements/:userId', protect, getUserLearningAchievements);
router.get('/track/:trackId', protect, getLearningTrack);
router.get('/swap/:swapId',  protect, getTracksForSwap);

// Milestones
router.post('/track/:trackId/milestones',                           protect, createMilestone);
router.put('/track/:trackId/milestones/:milestoneId',               protect, updateMilestone);
router.delete('/track/:trackId/milestones/:milestoneId',            protect, deleteMilestone);
router.post('/track/:trackId/milestones/:milestoneId/submit',       protect, submitMilestone);
router.post('/track/:trackId/milestones/:milestoneId/review',       protect, reviewMilestone);

// Assessments
router.post('/track/:trackId/assessments',                                          protect, createAssessment);
router.post('/track/:trackId/assessments/:assessmentId/quiz-submit',                protect, submitQuizAssessment);
router.post('/track/:trackId/assessments/:assessmentId/practical-submit',           protect, submitPracticalAssessment);
router.post('/track/:trackId/assessments/:assessmentId/practical-evaluate',        protect, evaluatePracticalAssessment);

module.exports = router;
