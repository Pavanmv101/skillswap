const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const User = require('./models/User');
const SwapRequest = require('./models/SwapRequest');
const Rating = require('./models/Rating');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/skillswap';

const demoUsers = [
  {
    name: 'Aarav Sharma',
    email: 'aarav@skillswap.com',
    password: 'password123',
    bio: 'Full stack MERN developer and open-source enthusiast. Passionate about teaching React and JavaScript.',
    skillsOffered: [
      { skill: 'React', category: 'Programming', level: 'Advanced' },
      { skill: 'JavaScript', category: 'Programming', level: 'Advanced' },
      { skill: 'Node.js', category: 'Programming', level: 'Intermediate' }
    ],
    skillsWanted: [
      { skill: 'Python', category: 'Programming', priority: 'High' },
      { skill: 'Machine Learning', category: 'Academic', priority: 'Medium' }
    ],
    availabilitySlots: [
      { day: 'Monday', from: '17:00', to: '20:00' },
      { day: 'Wednesday', from: '18:00', to: '21:00' },
      { day: 'Saturday', from: '10:00', to: '14:00' }
    ]
  },
  {
    name: 'Priya Patel',
    email: 'priya@skillswap.com',
    password: 'password123',
    bio: 'Data science student & Python trainer. Looking to build frontends for my analytics dashboards.',
    skillsOffered: [
      { skill: 'Python', category: 'Programming', level: 'Advanced' },
      { skill: 'Machine Learning', category: 'Academic', level: 'Intermediate' },
      { skill: 'Data Analysis', category: 'Academic', level: 'Advanced' }
    ],
    skillsWanted: [
      { skill: 'React', category: 'Programming', priority: 'High' },
      { skill: 'UI/UX Design', category: 'Design', priority: 'Medium' }
    ],
    availabilitySlots: [
      { day: 'Monday', from: '18:00', to: '21:00' },
      { day: 'Thursday', from: '17:00', to: '19:00' },
      { day: 'Saturday', from: '11:00', to: '15:00' }
    ]
  },
  {
    name: 'Rohan Verma',
    email: 'rohan@skillswap.com',
    password: 'password123',
    bio: 'Product Designer with 3+ years creating web and mobile interfaces using Figma.',
    skillsOffered: [
      { skill: 'UI/UX Design', category: 'Design', level: 'Advanced' },
      { skill: 'Figma', category: 'Design', level: 'Advanced' }
    ],
    skillsWanted: [
      { skill: 'JavaScript', category: 'Programming', priority: 'High' },
      { skill: 'React', category: 'Programming', priority: 'Medium' }
    ],
    availabilitySlots: [
      { day: 'Tuesday', from: '19:00', to: '22:00' },
      { day: 'Friday', from: '18:00', to: '21:00' },
      { day: 'Sunday', from: '10:00', to: '13:00' }
    ]
  },
  {
    name: 'Sneha Kulkarni',
    email: 'sneha@skillswap.com',
    password: 'password123',
    bio: 'Guitar player for 6 years and indie music producer. Love learning tech on weekends.',
    skillsOffered: [
      { skill: 'Acoustic Guitar', category: 'Music', level: 'Advanced' },
      { skill: 'Music Production', category: 'Music', level: 'Intermediate' }
    ],
    skillsWanted: [
      { skill: 'Python', category: 'Programming', priority: 'Medium' },
      { skill: 'Spanish', category: 'Language', priority: 'Low' }
    ],
    availabilitySlots: [
      { day: 'Saturday', from: '14:00', to: '18:00' },
      { day: 'Sunday', from: '15:00', to: '19:00' }
    ]
  }
];

async function seed() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB for seeding...');

    // Clean up previous seeded data (only the demo accounts to avoid deleting user's own account)
    const demoEmails = demoUsers.map(u => u.email);
    const existingUsers = await User.find({ email: { $in: demoEmails } });
    const userIds = existingUsers.map(u => u._id);

    if (userIds.length > 0) {
      await Rating.deleteMany({ $or: [{ rater: { $in: userIds } }, { ratee: { $in: userIds } }] });
      await SwapRequest.deleteMany({ $or: [{ fromUser: { $in: userIds } }, { toUser: { $in: userIds } }] });
      await User.deleteMany({ _id: { $in: userIds } });
      console.log(`Removed ${userIds.length} existing demo users`);
    }

    // Insert demo users with hashed passwords
    const createdUsers = [];
    for (const u of demoUsers) {
      const hashedPassword = await bcrypt.hash(u.password, 10);
      const newUser = new User({
        ...u,
        password: hashedPassword,
        averageRating: 0,
        totalRatings: 0
      });
      const saved = await newUser.save();
      createdUsers.push(saved);
      console.log(`Created user: ${saved.name} (${saved.email})`);
    }

    // Create a sample completed swap between Aarav and Priya
    const aarav = createdUsers.find(u => u.email === 'aarav@skillswap.com');
    const priya = createdUsers.find(u => u.email === 'priya@skillswap.com');

    const sampleSwap = new SwapRequest({
      fromUser: aarav._id,
      toUser: priya._id,
      offeredSkill: 'React',
      wantedSkill: 'Python',
      status: 'completed',
      compatibilityScore: 100,
      compatibilityNote: 'They offer 1 skill(s) you want: Python. You offer 1 skill(s) they want: React.',
      roomId: `skillswap-demo-${Date.now()}`,
      scheduledAt: new Date(Date.now() - 86400000) // yesterday
    });
    await sampleSwap.save();

    // Create mutual ratings for this swap
    const rating1 = new Rating({
      swapRequest: sampleSwap._id,
      rater: aarav._id,
      ratee: priya._id,
      score: 5,
      comment: 'Priya was an exceptional tutor! She explained Python fundamentals and data structures very clearly.'
    });
    await rating1.save();

    const rating2 = new Rating({
      swapRequest: sampleSwap._id,
      rater: priya._id,
      ratee: aarav._id,
      score: 5,
      comment: 'Aarav is super patient and knowledgeable with React hooks and component lifecycle. Great session!'
    });
    await rating2.save();

    // Update their rating aggregates
    aarav.averageRating = 5;
    aarav.totalRatings = 1;
    await aarav.save();

    priya.averageRating = 5;
    priya.totalRatings = 1;
    await priya.save();

    console.log('✅ Database seeded successfully with demo profiles, completed swap, and ratings!');
    console.log('Demo Login Credentials:');
    console.log('  Email: aarav@skillswap.com | Password: password123');
    console.log('  Email: priya@skillswap.com | Password: password123');
    console.log('  Email: rohan@skillswap.com | Password: password123');
    console.log('  Email: sneha@skillswap.com | Password: password123');

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('Seeding error:', err);
    process.exit(1);
  }
}

seed();
