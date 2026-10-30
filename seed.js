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
    bio: 'Full stack MERN developer and open-source enthusiast. Passionate about teaching React, JavaScript, and Node.js.',
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
    ],
    credits: 10
  },
  {
    name: 'Priya Patel',
    email: 'priya@skillswap.com',
    password: 'password123',
    bio: 'Data science student & Python trainer. Looking to build responsive web frontends for my analytics dashboards.',
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
    ],
    credits: 15
  },
  {
    name: 'Rohan Verma',
    email: 'rohan@skillswap.com',
    password: 'password123',
    bio: 'Product Designer with 3+ years creating intuitive web and mobile interfaces in Figma. Curious about frontend coding.',
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
    ],
    credits: 8
  },
  {
    name: 'Sneha Kulkarni',
    email: 'sneha@skillswap.com',
    password: 'password123',
    bio: 'Acoustic guitarist for 6 years and indie music producer. Keen to learn Python programming and creative coding on weekends.',
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
    ],
    credits: 12
  }
];

async function seed() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB for seeding...');

    // Clean up previous seeded data safely (only target the 4 demo emails)
    const demoEmails = demoUsers.map(u => u.email);
    const existingUsers = await User.find({ email: { $in: demoEmails } });
    const userIds = existingUsers.map(u => u._id);

    if (userIds.length > 0) {
      await Rating.deleteMany({ $or: [{ rater: { $in: userIds } }, { ratee: { $in: userIds } }] });
      await SwapRequest.deleteMany({ $or: [{ fromUser: { $in: userIds } }, { toUser: { $in: userIds } }] });
      await User.deleteMany({ _id: { $in: userIds } });
      console.log(`Cleaned up ${userIds.length} existing demo users and associated swaps/ratings`);
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

    const aarav = createdUsers.find(u => u.email === 'aarav@skillswap.com');
    const priya = createdUsers.find(u => u.email === 'priya@skillswap.com');
    const rohan = createdUsers.find(u => u.email === 'rohan@skillswap.com');
    const sneha = createdUsers.find(u => u.email === 'sneha@skillswap.com');

    // 1. COMPLETED SWAP: Aarav <-> Priya (with mutual 5-star ratings)
    const completedSwap = new SwapRequest({
      fromUser: aarav._id,
      toUser: priya._id,
      offeredSkill: 'React',
      wantedSkill: 'Python',
      status: 'completed',
      compatibilityScore: 100,
      compatibilityNote: 'They offer 1 skill(s) you want: Python. You offer 1 skill(s) they want: React.',
      roomId: `skillswap-completed-${aarav._id.toString().slice(-4)}-${priya._id.toString().slice(-4)}`,
      scheduledAt: new Date(Date.now() - 2 * 86400000) // 2 days ago
    });
    await completedSwap.save();

    // Mutual ratings for completed swap
    const rating1 = new Rating({
      swapRequest: completedSwap._id,
      rater: aarav._id,
      ratee: priya._id,
      score: 5,
      comment: 'Priya was an exceptional tutor! She explained Python fundamentals and data structures very clearly.'
    });
    await rating1.save();

    const rating2 = new Rating({
      swapRequest: completedSwap._id,
      rater: priya._id,
      ratee: aarav._id,
      score: 5,
      comment: 'Aarav is super patient and knowledgeable with React hooks and component lifecycle. Great session!'
    });
    await rating2.save();

    // 2. ACCEPTED (ACTIVE) SWAP: Aarav <-> Rohan (scheduled upcoming session with live room ID)
    const acceptedSwap = new SwapRequest({
      fromUser: rohan._id,
      toUser: aarav._id,
      offeredSkill: 'UI/UX Design',
      wantedSkill: 'React',
      status: 'accepted',
      compatibilityScore: 80,
      compatibilityNote: 'They offer UI/UX Design. You teach React which they want.',
      roomId: `skillswap-room-${aarav._id.toString().slice(-4)}-${rohan._id.toString().slice(-4)}`,
      scheduledAt: new Date(Date.now() + 86400000) // Tomorrow
    });
    await acceptedSwap.save();

    // 3. PENDING SWAP (Incoming for Aarav): Sneha -> Aarav
    const pendingIncomingSwap = new SwapRequest({
      fromUser: sneha._id,
      toUser: aarav._id,
      offeredSkill: 'Acoustic Guitar',
      wantedSkill: 'JavaScript',
      status: 'pending',
      compatibilityScore: 60,
      compatibilityNote: 'Sneha wants to learn JavaScript from you in exchange for Acoustic Guitar lessons.'
    });
    await pendingIncomingSwap.save();

    // 4. PENDING SWAP (Sent by Aarav): Aarav -> Priya (Follow-up Machine Learning session)
    const pendingSentSwap = new SwapRequest({
      fromUser: aarav._id,
      toUser: priya._id,
      offeredSkill: 'Node.js',
      wantedSkill: 'Machine Learning',
      status: 'pending',
      compatibilityScore: 90,
      compatibilityNote: 'Advanced backend Node.js for Machine Learning algorithms exchange.'
    });
    await pendingSentSwap.save();

    // 5. CANCELLED SWAP: Rohan -> Priya
    const cancelledSwap = new SwapRequest({
      fromUser: rohan._id,
      toUser: priya._id,
      offeredSkill: 'Figma',
      wantedSkill: 'Data Analysis',
      status: 'cancelled',
      compatibilityScore: 50,
      compatibilityNote: 'Cancelled by sender due to semester schedule conflict.',
      cancelReason: 'Semester exam timetable clash'
    });
    await cancelledSwap.save();

    // Update rating stats for Aarav & Priya
    aarav.averageRating = 5.0;
    aarav.totalRatings = 1;
    await aarav.save();

    priya.averageRating = 5.0;
    priya.totalRatings = 1;
    await priya.save();

    console.log('✅ Database seeded successfully with demo profiles, swaps across all statuses, and verified ratings!');
    console.log('\nDemo User Accounts (all passwords: password123):');
    console.log('  1. Aarav Sharma  - aarav@skillswap.com  (React, JS, Node.js)')
    console.log('  2. Priya Patel   - priya@skillswap.com   (Python, ML, Data Analysis)')
    console.log('  3. Rohan Verma   - rohan@skillswap.com   (UI/UX Design, Figma)')
    console.log('  4. Sneha Kulkarni- sneha@skillswap.com   (Acoustic Guitar, Music Production)')
    console.log('\nSwaps Created:');
    console.log('  - Completed: Aarav <-> Priya (with mutual 5-star ratings)')
    console.log('  - Active/Accepted: Aarav <-> Rohan (scheduled tomorrow with WebRTC room ready)')
    console.log('  - Incoming Pending for Aarav: Sneha -> Aarav')
    console.log('  - Outgoing Pending from Aarav: Aarav -> Priya')
    console.log('  - Cancelled: Rohan -> Priya')

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('Seeding error:', err);
    process.exit(1);
  }
}

seed();
