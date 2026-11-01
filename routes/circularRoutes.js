/**
 * Phase 6 — Advanced Skill Exchange Algorithm (Step 3 - Substage 3.2)
 * routes/circularRoutes.js
 *
 * Exposes authenticated endpoints for Circular Three-Way Skill Exchange proposals:
 * - POST /api/circular/proposals         - Create 3-way circular proposal
 * - GET  /api/circular/proposals         - List participant's circular proposals
 * - GET  /api/circular/proposals/:id     - View circular proposal details
 * - PUT  /api/circular/proposals/:id/accept  - Accept invitation
 * - PUT  /api/circular/proposals/:id/decline - Decline invitation
 */

'use strict';

const express = require('express');
const router = express.Router();
const protect = require('../middleware/auth');
const {
  createCircularProposal,
  getCircularProposals,
  getCircularProposalById,
  acceptCircularInvitation,
  declineCircularInvitation,
} = require('../controllers/circularProposalController');

router.post('/proposals',             protect, createCircularProposal);
router.get('/proposals',              protect, getCircularProposals);
router.get('/proposals/:id',          protect, getCircularProposalById);
router.put('/proposals/:id/accept',   protect, acceptCircularInvitation);
router.put('/proposals/:id/decline',  protect, declineCircularInvitation);

module.exports = router;
