const mongoose = require('mongoose');
const User = require('../models/User');

// GET /api/profile
exports.getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('-password -blockedUsers');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.status(200).json(user);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET /api/profile/:id  — public profile view
exports.getPublicProfile = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid user ID' });
    }

    const user = await User.findById(req.params.id)
      .select('name bio skillsOffered skillsWanted availability availabilitySlots averageRating totalRatings createdAt');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.status(200).json(user);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// PUT /api/profile
exports.updateProfile = async (req, res) => {
  try {
    const { name, bio, skillsOffered, skillsWanted, availability, availabilitySlots } = req.body;

    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (name)               user.name               = name.trim();
    if (bio !== undefined)  user.bio                = bio.trim();
    if (skillsOffered)      user.skillsOffered      = skillsOffered;
    if (skillsWanted)       user.skillsWanted       = skillsWanted;
    if (availability !== undefined) user.availability = availability;
    if (availabilitySlots)  user.availabilitySlots  = availabilitySlots;

    const updated = await user.save();
    const userObj = updated.toObject();
    delete userObj.password;
    delete userObj.blockedUsers;

    res.status(200).json(userObj);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// POST /api/profile/block/:id — block a user
exports.blockUser = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid user ID' });
    }

    if (req.params.id.toString() === req.userId.toString()) {
      return res.status(400).json({ message: 'You cannot block yourself' });
    }

    const targetUser = await User.findById(req.params.id);
    if (!targetUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (!user.blockedUsers.some(b => b.toString() === req.params.id.toString())) {
      user.blockedUsers.push(req.params.id);
      await user.save();
    }

    res.status(200).json({ message: `Successfully blocked ${targetUser.name}` });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};
