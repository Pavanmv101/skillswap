const mongoose = require('mongoose');
const SkillVerification = require('../models/SkillVerification');
const User = require('../models/User');
const { createAndEmitNotification } = require('../services/notificationService');

// GET /api/admin/verifications
// Admin listing with status, category filters and student/skill search
exports.listVerifications = async (req, res) => {
  try {
    const { status, category, search, page = 1, limit = 20 } = req.query;
    const query = {};

    if (status && status !== 'all') {
      query.status = status;
    }

    if (category && category !== 'All') {
      query.category = new RegExp(`^${category}$`, 'i');
    }

    if (search && search.trim()) {
      const regex = new RegExp(search.trim(), 'i');
      const matchingUsers = await User.find({
        $or: [{ name: regex }, { email: regex }],
      }).select('_id');

      const userIds = matchingUsers.map(u => u._id);

      query.$or = [
        { skillName: regex },
        { user: { $in: userIds } },
      ];
    }

    const skip = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
    const take = Math.min(100, Math.max(1, parseInt(limit, 10)));

    const [verifications, total, pendingCount, verifiedCount, rejectedCount] = await Promise.all([
      SkillVerification.find(query)
        .populate('user', 'name email averageRating totalRatings skillsOffered')
        .populate('reviewedBy', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(take),
      SkillVerification.countDocuments(query),
      SkillVerification.countDocuments({ status: 'pending' }),
      SkillVerification.countDocuments({ status: 'verified' }),
      SkillVerification.countDocuments({ status: 'rejected' }),
    ]);

    res.status(200).json({
      verifications,
      total,
      page: parseInt(page, 10),
      totalPages: Math.ceil(total / take) || 1,
      counts: {
        pending: pendingCount,
        verified: verifiedCount,
        rejected: rejectedCount,
      },
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET /api/admin/verifications/:id
exports.getVerificationDetails = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid verification ID' });
    }

    const verification = await SkillVerification.findById(req.params.id)
      .populate('user', 'name email bio skillsOffered averageRating totalRatings createdAt')
      .populate('reviewedBy', 'name email');

    if (!verification) {
      return res.status(404).json({ message: 'Verification record not found' });
    }

    res.status(200).json(verification);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// PUT /api/admin/verifications/:id/approve
exports.approveVerification = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid verification ID' });
    }

    const verification = await SkillVerification.findById(req.params.id)
      .populate('user', 'name email skillsOffered');

    if (!verification) {
      return res.status(404).json({ message: 'Verification record not found' });
    }

    // Security requirement: Students/Admins must never approve their own submissions
    if (verification.user._id.toString() === req.userId.toString()) {
      return res.status(403).json({
        message: 'Security violation: Administrators cannot approve their own skill verification submissions',
      });
    }

    verification.status = 'verified';
    verification.reviewedBy = req.userId;
    verification.reviewedAt = new Date();
    verification.rejectionReason = '';

    await verification.save();

    // Update verified badge on the user's offered skills record
    await User.updateOne(
      {
        _id: verification.user._id,
        'skillsOffered.skill': new RegExp(`^${verification.skillName}$`, 'i'),
      },
      {
        $set: { 'skillsOffered.$.verified': true },
      }
    );

    // Trigger Notification for the student
    await createAndEmitNotification({
      recipient: verification.user._id,
      sender: req.userId,
      type: 'VERIFICATION_APPROVED',
      title: 'Skill Verified! 🎓',
      message: `Congratulations! Your verification submission for "${verification.skillName}" has been approved by an administrator. A verified badge now appears on your profile.`,
    });

    res.status(200).json({
      success: true,
      message: `Skill "${verification.skillName}" approved successfully`,
      verification,
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// PUT /api/admin/verifications/:id/reject
exports.rejectVerification = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid verification ID' });
    }

    const reasonText = (req.body.reason || req.body.rejectionReason || '').trim();
    if (!reasonText) {
      return res.status(400).json({ message: 'A rejection reason is mandatory' });
    }

    const verification = await SkillVerification.findById(req.params.id)
      .populate('user', 'name email skillsOffered');

    if (!verification) {
      return res.status(404).json({ message: 'Verification record not found' });
    }

    // Disallow self-review
    if (verification.user._id.toString() === req.userId.toString()) {
      return res.status(403).json({
        message: 'Security violation: Administrators cannot review their own submissions',
      });
    }

    verification.status = 'rejected';
    verification.reviewedBy = req.userId;
    verification.reviewedAt = new Date();
    verification.rejectionReason = reasonText;

    await verification.save();

    // Remove verified badge if previously verified
    await User.updateOne(
      {
        _id: verification.user._id,
        'skillsOffered.skill': new RegExp(`^${verification.skillName}$`, 'i'),
      },
      {
        $set: { 'skillsOffered.$.verified': false },
      }
    );

    // Trigger Notification for the student with specific reason
    await createAndEmitNotification({
      recipient: verification.user._id,
      sender: req.userId,
      type: 'VERIFICATION_REJECTED',
      title: 'Skill Verification Update',
      message: `Your verification submission for "${verification.skillName}" was not approved. Feedback: "${reasonText}". You may resubmit with updated evidence.`,
    });

    res.status(200).json({
      success: true,
      message: `Skill "${verification.skillName}" rejected`,
      verification,
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};
