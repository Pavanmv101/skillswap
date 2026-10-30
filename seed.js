const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const User = require('./models/User');
const SwapRequest = require('./models/SwapRequest');
const Rating = require('./models/Rating');
const Notification = require('./models/Notification');
const SkillVerification = require('./models/SkillVerification');
const Endorsement = require('./models/Endorsement');
const LearningTrack = require('./models/LearningTrack');

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
  },
  {
    name: 'Administrator',
    email: 'admin@skillswap.com',
    password: 'password123',
    role: 'admin',
    bio: 'Platform Administrator & Skill Verification Officer.',
    skillsOffered: [],
    skillsWanted: [],
    availabilitySlots: [],
    credits: 999
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
      await Notification.deleteMany({ $or: [{ recipient: { $in: userIds } }, { sender: { $in: userIds } }] });
      await Endorsement.deleteMany({ $or: [{ endorser: { $in: userIds } }, { recipient: { $in: userIds } }] });
      await LearningTrack.deleteMany({ $or: [{ learner: { $in: userIds } }, { instructor: { $in: userIds } }] });
      await SkillVerification.deleteMany({ user: { $in: userIds } });
      await SwapRequest.deleteMany({ $or: [{ fromUser: { $in: userIds } }, { toUser: { $in: userIds } }] });
      await User.deleteMany({ _id: { $in: userIds } });
      console.log(`Cleaned up ${userIds.length} existing demo users and associated swaps/ratings/notifications/verifications`);
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
    const admin = createdUsers.find(u => u.email === 'admin@skillswap.com');

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

    // 6. DEMO NOTIFICATIONS
    // Notification for Aarav: Sneha sent swap request (unread)
    await new Notification({
      recipient: aarav._id,
      sender: sneha._id,
      type: 'SWAP_REQUEST',
      title: 'New Skill Swap Request ⚡',
      message: 'Sneha Kulkarni wants to swap skills: offering "Acoustic Guitar" in exchange for your "JavaScript".',
      relatedSwap: pendingIncomingSwap._id,
      isRead: false,
      createdAt: new Date(Date.now() - 3600000), // 1 hour ago
    }).save();

    // Notification for Aarav: Rohan scheduled live session (unread)
    await new Notification({
      recipient: aarav._id,
      sender: rohan._id,
      type: 'SESSION_SCHEDULED',
      title: 'Session Scheduled 📅',
      message: 'Rohan Verma scheduled your video session for tomorrow.',
      relatedSwap: acceptedSwap._id,
      isRead: false,
      createdAt: new Date(Date.now() - 1800000), // 30 mins ago
    }).save();

    // Notification for Aarav: Priya marked exchange as completed (read)
    await new Notification({
      recipient: aarav._id,
      sender: priya._id,
      type: 'SWAP_COMPLETED',
      title: 'Swap Marked as Completed! ⭐',
      message: 'Priya Patel marked your exchange as completed. Please write a review and leave an endorsement!',
      relatedSwap: completedSwap._id,
      isRead: true,
      createdAt: new Date(Date.now() - 86400000), // yesterday
    }).save();

    // Notification for Priya: Aarav sent swap proposal (unread)
    await new Notification({
      recipient: priya._id,
      sender: aarav._id,
      type: 'SWAP_REQUEST',
      title: 'New Skill Swap Request ⚡',
      message: 'Aarav Sharma wants to swap skills: offering "Node.js" in exchange for your "Machine Learning".',
      relatedSwap: pendingSentSwap._id,
      isRead: false,
      createdAt: new Date(Date.now() - 7200000),
    }).save();

    // 7. DEMO SKILL VERIFICATIONS
    // Aarav: React verified by Administrator
    const aaravVerification = new SkillVerification({
      user: aarav._id,
      skillName: 'React',
      category: 'Programming',
      evidenceType: 'github',
      evidenceUrl: 'https://github.com/aaravsharma/production-react-apps',
      description: 'Built enterprise-grade React 18 applications using custom hooks, Suspense, and performance profiling.',
      status: 'verified',
      reviewedBy: admin._id,
      reviewedAt: new Date(Date.now() - 86400000 * 3),
    });
    await aaravVerification.save();

    // Mark React as verified on Aarav's user document
    await User.updateOne(
      { _id: aarav._id, 'skillsOffered.skill': 'React' },
      { $set: { 'skillsOffered.$.verified': true } }
    );

    // Priya: Python pending verification review
    const priyaVerification = new SkillVerification({
      user: priya._id,
      skillName: 'Python',
      category: 'Programming',
      evidenceType: 'github',
      evidenceUrl: 'https://github.com/priyapatel/data-science-algorithms',
      description: 'Developed Python computational pipelines, NumPy implementations, and Pandas data sanitization modules.',
      status: 'pending',
    });
    await priyaVerification.save();

    // 8. PEER SKILL ENDORSEMENTS (Following completed swap)
    // Aarav endorses Priya for Python
    await new Endorsement({
      endorser: aarav._id,
      recipient: priya._id,
      skillName: 'Python',
      swapRequest: completedSwap._id,
      comment: 'Exceptional mastery of Python data structures and algorithm analysis.',
    }).save();

    // Priya endorses Aarav for React
    await new Endorsement({
      endorser: priya._id,
      recipient: aarav._id,
      skillName: 'React',
      swapRequest: completedSwap._id,
      comment: 'Superb React instructor. Explains state isolation and modern hooks effortlessly.',
    }).save();

    // 9. LEARNING TRACKS & ASSESSMENTS (Phase 4)
    // Aarav learning Python from Priya (Completed Track)
    const aaravPythonTrack = new LearningTrack({
      swapRequest: completedSwap._id,
      learner: aarav._id,
      instructor: priya._id,
      skillName: 'Python',
      skillCategory: 'Programming',
      learningObjective: 'Master Python fundamentals, OOP, and data science essentials',
      status: 'completed',
      overallProgress: 100,
      completedAt: new Date(Date.now() - 86400000),
      milestones: [
        {
          title: 'Python Syntax & Data Structures',
          description: 'Lists, dictionaries, sets, loops, and functional comprehensions.',
          sequence: 1,
          status: 'approved',
          instructorApprovalStatus: 'approved',
          completedAt: new Date(Date.now() - 86400000 * 5),
          feedback: 'Flawless code structure and idiomatic Python usage.',
        },
        {
          title: 'OOP & Modular Architecture in Python',
          description: 'Classes, inheritance, dunder methods, and virtual environments.',
          sequence: 2,
          status: 'approved',
          instructorApprovalStatus: 'approved',
          completedAt: new Date(Date.now() - 86400000 * 3),
          feedback: 'Solid object hierarchy and clean modular packaging.',
        },
        {
          title: 'Data Analysis with Pandas & NumPy',
          description: 'DataFrame manipulation, vector operations, and visualization.',
          sequence: 3,
          status: 'approved',
          instructorApprovalStatus: 'approved',
          completedAt: new Date(Date.now() - 86400000),
          feedback: 'Great insights extracted from the dataset.',
        },
      ],
      assessments: [
        {
          type: 'practical',
          title: 'Sales Data Analysis Pipeline',
          description: 'Analyze CSV transaction logs and generate aggregated monthly reporting.',
          passingScore: 75,
          instructions: 'Use pandas to group by categories and identify the top 5 revenue drivers.',
          submissionText: 'Engineered pandas pipeline grouping by monthly SKU sales with matplot charts.',
          evidenceUrl: 'https://github.com/aaravsharma/python-sales-analysis',
          evaluationStatus: 'evaluated',
          passed: true,
          evaluatedAt: new Date(Date.now() - 86400000),
          instructorFeedback: 'Accurate data aggregation and comprehensive summary report.',
        },
      ],
    });
    await aaravPythonTrack.save();

    // Priya learning React from Aarav (In Progress Track: 67%)
    const priyaReactTrack = new LearningTrack({
      swapRequest: completedSwap._id,
      learner: priya._id,
      instructor: aarav._id,
      skillName: 'React',
      skillCategory: 'Programming',
      learningObjective: 'Learn modern React 18, Hooks, and Component Architecture',
      status: 'in_progress',
      overallProgress: 67,
      milestones: [
        {
          title: 'React Fundamentals & Component JSX',
          description: 'Props, state, and unidirectional data flow in React 18.',
          sequence: 1,
          status: 'approved',
          instructorApprovalStatus: 'approved',
          completedAt: new Date(Date.now() - 86400000 * 4),
          feedback: 'Clear mental model of component lifecycles and immutable state.',
        },
        {
          title: 'Hooks Mastery (useState, useEffect, useMemo)',
          description: 'Side-effects management and performance memoization.',
          sequence: 2,
          status: 'approved',
          instructorApprovalStatus: 'approved',
          completedAt: new Date(Date.now() - 86400000 * 2),
          feedback: 'Proper dependency array handling and clean cleanup functions.',
        },
        {
          title: 'Full-Stack SPA with Context API',
          description: 'Build a peer task manager with global context and localStorage persistence.',
          sequence: 3,
          status: 'submitted',
          instructorApprovalStatus: 'pending',
          evidenceUrl: 'https://github.com/priyapatel/react-task-manager',
          submissionNotes: 'Implemented context store with optimistic updates and responsive dark mode.',
        },
      ],
      assessments: [
        {
          type: 'quiz',
          title: 'React Core Principles & Hooks Quiz',
          description: 'Test your understanding of component re-renders, virtual DOM, and hook rules.',
          passingScore: 70,
          questions: [
            {
              question: 'When does a React component re-render by default?',
              options: [
                'Only when explicitly triggered by window reload',
                'Whenever its state or props change',
                'Every 1000 milliseconds automatically',
                'Only when a child component dismounts',
              ],
              correctOption: 1,
            },
            {
              question: 'What is the purpose of the dependency array in useEffect?',
              options: [
                'To control when the effect re-runs based on value changes',
                'To import external npm packages into the hook',
                'To style the parent DOM container',
                'To prevent asynchronous network fetches',
              ],
              correctOption: 0,
            },
          ],
          attempts: [
            {
              attemptedAt: new Date(Date.now() - 86400000 * 2),
              selectedAnswers: [1, 0],
              score: 100,
              passed: true,
            },
          ],
        },
      ],
    });
    await priyaReactTrack.save();

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
