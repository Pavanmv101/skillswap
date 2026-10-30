const mongoose = require('mongoose');
const Endorsement = require('../models/Endorsement');
const SwapRequest = require('../models/SwapRequest');
const User = require('../models/User');
const { createAndEmitNotification } = require('../services/notificationService');

// POST /api/endorsements
exports.createEndorsement = async (req, res) => {
  try {
    const { recipient, skillName, swapRequestId, comment } = req.body;

    if (!recipient || !skillName || !swapRequestId) {
      return res.status(400).json({ message: 'recipient, skillName, and swapRequestId are required' });
    }

    if (!mongoose.Types.ObjectId.isValid(recipient) || !mongoose.Types.ObjectId.isValid(swapRequestId)) {
      return res.status(400).json({ message: 'Invalid recipient or swapRequestId ID' });
    }

    // 1. Prevent self-endorsement
    if (recipient.toString() === req.userId.toString()) {
      return res.status(400).json({ message: 'You cannot endorse your own skills' });
    }

    // 2. Verify completed swap between the two students
    const swap = await SwapRequest.findById(swapRequestId);
    if (!swap) {
      return res.status(404).json({ message: 'Swap exchange record not found' });
    }

    if (swap.status !== 'completed') {
      return res.status(400).json({
        message: 'You can only endorse skills after successfully completing a swap session with this partner',
      });
    }

    const isFromUser = swap.fromUser.toString() === req.userId.toString();
    const isToUser   = swap.toUser.toString()   === req.userId.toString();
    const isPartnerFrom = swap.fromUser.toString() === recipient.toString();
    const isPartnerTo   = swap.toUser.toString()   === recipient.toString();

    if (!((isFromUser && isPartnerTo) || (isToUser && isPartnerFrom))) {
      return res.status(403).json({
        message: 'You must have a completed barter swap directly with this partner to endorse them',
      });
    }

    // 3. Verify recipient offers this skill
    const targetUser = await User.findById(recipient);
    if (!targetUser) return res.status(404).json({ message: 'Recipient not found' });

    const offersSkill = (targetUser.skillsOffered || []).some(
      s => s.skill.toLowerCase() === skillName.trim().toLowerCase()
    );

    if (!offersSkill) {
      return res.status(400).json({
        message: `${targetUser.name} does not list "${skillName}" in their offered skills`,
      });
    }

    // 4. Prevent duplicate endorsement from same user for same partner and skill
    const existing = await Endorsement.findOne({
      endorser: req.userId,
      recipient,
      skillName: skillName.trim(),
    });

    if (existing) {
      return res.status(400).json({
        message: `You have already endorsed ${targetUser.name}'s proficiency in "${skillName}"`,
      });
    }

    const endorserUser = await User.findById(req.userId).select('name');

    const endorsement = new Endorsement({
      endorser: req.userId,
      recipient,
      skillName: skillName.trim(),
      swapRequest: swapRequestId,
      comment: (comment || '').trim(),
    });

    await endorsement.save();
    await endorsement.populate('endorser', 'name email');

    // Trigger Notification for the recipient
    await createAndEmitNotification({
      recipient,
      sender: req.userId,
      type: 'ENDORSEMENT_RECEIVED',
      title: 'Peer Skill Endorsement! ⭐',
      message: `${endorserUser.name} endorsed your skill in "${skillName}" following your completed exchange!`,
      relatedSwap: swapRequestId,
    });

    res.status(201).json(endorsement);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ message: 'Duplicate endorsement detected' });
    }
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET /api/endorsements/:userId
// Returns all endorsements for a specific student, grouped by skill
exports.getUserEndorsements = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.userId)) {
      return res.status(400).json({ message: 'Invalid user ID' });
    }

    const endorsements = await Endorsement.find({ recipient: req.params.userId })
      .populate('endorser', 'name email')
      .populate('swapRequest', 'offeredSkill wantedSkill')
      .sort({ createdAt: -1 });

    // Compute counts per skill
    const countsBySkill = {};
    for (const e of endorsements) {
      const s = e.skillName;
      countsBySkill[s] = (countsBySkill[s] || 0) + 1;
    }

    res.status(200).json({
      endorsements,
      total: endorsements.length,
      countsBySkill,
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};
