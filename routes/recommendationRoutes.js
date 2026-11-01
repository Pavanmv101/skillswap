'use strict';

const express = require('express');
const router  = express.Router();
const protect = require('../middleware/auth');
const {
  getRecommendedPartners,
  getDashboardRecommendations,
  getSkillSuggestions,
  getCircularRecommendations,
} = require('../controllers/recommendationController');

// All routes require authentication
router.get('/partners',   protect, getRecommendedPartners);
router.get('/dashboard',  protect, getDashboardRecommendations);
router.get('/skills',     protect, getSkillSuggestions);
router.get('/circular',   protect, getCircularRecommendations);

module.exports = router;
