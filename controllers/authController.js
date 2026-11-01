const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Helper: creates a signed JWT for a given user id
function generateToken(userId) {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

// POST /api/auth/register
exports.register = async (req, res) => {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ message: 'Invalid request body' });
    }

    const { name, email, password } = req.body;

    if (name === undefined || email === undefined || password === undefined || name === null || email === null || password === null) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    if (
      typeof name !== 'string' ||
      typeof email !== 'string' ||
      typeof password !== 'string'
    ) {
      return res.status(400).json({ message: 'Name, email, and password must be strings' });
    }

    const cleanName = name.trim();
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanName || !cleanEmail || !password) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    const existingUser = await User.findOne({ email: cleanEmail });
    if (existingUser) {
      return res.status(400).json({ message: 'Email already registered' });
    }

    // Hash the password before saving - plain text is never stored
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const user = await User.create({
      name: cleanName,
      email: cleanEmail,
      password: hashedPassword,
    });

    const token = generateToken(user._id);

    res.status(201).json({
      token,
      user: { id: user._id, name: user.name, email: user.email, role: user.role || 'student' },
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// POST /api/auth/login
exports.login = async (req, res) => {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ message: 'Invalid request body' });
    }

    const { email, password } = req.body;

    if (email === undefined || password === undefined || email === null || password === null) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ message: 'Email and password must be strings' });
    }

    const cleanEmail = email.trim().toLowerCase();

    if (!cleanEmail || !password) {
      return res.status(400).json({ message: 'Invalid email or password' });
    }

    const user = await User.findOne({ email: cleanEmail });
    if (!user) {
      return res.status(400).json({ message: 'Invalid email or password' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid email or password' });
    }

    const token = generateToken(user._id);

    res.status(200).json({
      token,
      user: { id: user._id, name: user.name, email: user.email, role: user.role || 'student' },
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// POST /api/auth/seed-demo
// Safely seeds the demo student and admin accounts if they do not already exist
exports.seedDemoAccounts = async (req, res) => {
  try {
    if (req.body && (typeof req.body !== 'object' || Array.isArray(req.body))) {
      return res.status(400).json({ message: 'Invalid request body' });
    }

    const priya = await User.findOne({ email: 'priya@skillswap.com' });
    if (priya) {
      return res.status(200).json({
        message: 'Demo accounts already exist in the database',
        seeded: false,
      });
    }

    const { seedDemoData } = require('../seed');
    await seedDemoData(false);

    res.status(201).json({
      message: 'Demo accounts seeded successfully!',
      seeded: true,
      demoUsers: [
        'priya@skillswap.com',
        'aarav@skillswap.com',
        'rohan@skillswap.com',
        'sneha@skillswap.com',
        'admin@skillswap.com',
      ],
    });
  } catch (err) {
    console.error('[Auth] Error seeding demo accounts:', err);
    res.status(500).json({ message: 'Failed to seed demo accounts', error: err.message });
  }
};

