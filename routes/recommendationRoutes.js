'use strict';

const express = require('express');
const router  = express.Router();
const protect = require('../middleware/auth');
const {
  getRecommendedPartners,
  getDashboardRecommendations,
  getSkillSuggestions,
} = require('../controllers/recommendationController');

// All routes require authentication
router.get('/partners',   protect, getRecommendedPartners);
router.get('/dashboard',  protect, getDashboardRecommendations);
router.get('/skills',     protect, getSkillSuggestions);

module.exports = router;
