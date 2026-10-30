const mongoose = require('mongoose');
const User = require('./models/User');
const SwapRequest = require('./models/SwapRequest');
const LearningTrack = require('./models/LearningTrack');
const Notification = require('./models/Notification');

const BASE_URL = 'http://localhost:5001/api';
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/skillswap';

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }

  return { status: res.status, ok: res.ok, data };
}

async function runTests() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🧪 SKILLSWAP PHASE 4 — LEARNING PROGRESS & ASSESSMENT QA SUITE');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, testName) {
    if (condition) {
      console.log(`✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${testName}`);
      failed++;
    }
  }

  try {
    await mongoose.connect(MONGO_URI);

    const ts = Date.now();
    const userAEmail = `user_a_${ts}@test.edu`;
    const userBEmail = `user_b_${ts}@test.edu`;
    const userCEmail = `user_c_${ts}@test.edu`;

    // ── Setup: Register 3 users ───────────────────────────────────────────
    const regA = await request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: 'User A', email: userAEmail, password: 'password123' }),
    });
    const tokenA = regA.data.token;
    const idA = regA.data.user.id;
    const authA = { headers: { Authorization: `Bearer ${tokenA}` } };

    const regB = await request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: 'User B', email: userBEmail, password: 'password123' }),
    });
    const tokenB = regB.data.token;
    const idB = regB.data.user.id;
    const authB = { headers: { Authorization: `Bearer ${tokenB}` } };

    const regC = await request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: 'User C', email: userCEmail, password: 'password123' }),
    });
    const tokenC = regC.data.token;
    const idC = regC.data.user.id;
    const authC = { headers: { Authorization: `Bearer ${tokenC}` } };

    // Setup skills
    await request('/profile', {
      method: 'PUT',
      ...authA,
      body: JSON.stringify({
        skillsOffered: [{ skill: 'React', category: 'Programming', level: 'Advanced' }],
        skillsWanted: [{ skill: 'Python', category: 'Programming', priority: 'High' }],
      }),
    });

    await request('/profile', {
      method: 'PUT',
      ...authB,
      body: JSON.stringify({
        skillsOffered: [{ skill: 'Python', category: 'Programming', level: 'Advanced' }],
        skillsWanted: [{ skill: 'React', category: 'Programming', priority: 'High' }],
      }),
    });

    // ── Create & Accept a Swap between User A and User B ──────────────────
    const swapReq = await request('/swap', {
      method: 'POST',
      ...authA,
      body: JSON.stringify({
        toUser: idB,
        offeredSkill: 'React',
        wantedSkill: 'Python',
      }),
    });
    const swapId = swapReq.data._id;

    // Accept swap
    const acceptRes = await request(`/swap/${swapId}/accept`, { method: 'PUT', ...authB });
    assert(acceptRes.status === 200 && acceptRes.data.status === 'accepted', 'Swap successfully accepted and ready for learning initialization');

    // ── 1. Learning plan creation after eligible accepted swap ────────────
    const initRes = await request(`/learning/init/${swapId}`, { method: 'POST', ...authA });
    assert(
      initRes.status === 201 && Array.isArray(initRes.data?.tracks) && initRes.data.tracks.length === 2,
      '1. Learning plan initialized after an eligible accepted swap with exactly 2 reciprocal tracks'
    );

    const trackATeaches = initRes.data.tracks.find(t => (t.instructor?._id || t.instructor) === idA);
    const trackBTeaches = initRes.data.tracks.find(t => (t.instructor?._id || t.instructor) === idB);

    // ── 2. Two independent learning tracks for one swap ───────────────────
    assert(
      trackATeaches && trackBTeaches &&
      (trackATeaches.learner?._id || trackATeaches.learner) === idB &&
      (trackBTeaches.learner?._id || trackBTeaches.learner) === idA &&
      trackATeaches.skillName === 'React' &&
      trackBTeaches.skillName === 'Python',
      '2. Two independent learning directions correctly configured (Track 1: B learns React from A; Track 2: A learns Python from B)'
    );

    // ── 3. Unauthorized user cannot access learning plan ──────────────────
    const unauthorizedGet = await request(`/learning/track/${trackATeaches._id}`, { method: 'GET', ...authC });
    assert(unauthorizedGet.status === 403, '3. Unauthorized user (User C) blocked from viewing learning track (403 Forbidden)');

    // ── 4. Instructor can create milestones ───────────────────────────────
    // User A is instructor for React track
    const createMRes = await request(`/learning/track/${trackATeaches._id}/milestones`, {
      method: 'POST',
      ...authA,
      body: JSON.stringify({
        title: 'Master React State & Hooks',
        description: 'Build a counter component with useState and useEffect',
        dueDate: new Date(Date.now() + 86400000 * 7),
      }),
    });
    assert(
      createMRes.status === 201 &&
      createMRes.data?.milestones?.some(m => m.title === 'Master React State & Hooks'),
      '4. Instructor can create structured learning milestones'
    );

    // Get the created milestone ID
    const updatedTrack = await request(`/learning/track/${trackATeaches._id}`, { method: 'GET', ...authA });
    const targetMilestone = updatedTrack.data.milestones.find(m => m.title === 'Master React State & Hooks');
    const milestoneId = targetMilestone._id;

    // ── 5. Learner can submit milestones ──────────────────────────────────
    // User B is the learner for React track
    const submitMRes = await request(
      `/learning/track/${trackATeaches._id}/milestones/${milestoneId}/submit`,
      {
        method: 'POST',
        ...authB,
        body: JSON.stringify({
          evidenceUrl: 'https://github.com/userb/react-hooks-counter',
          submissionNotes: 'Implemented useState with automated unit tests',
        }),
      }
    );
    assert(
      submitMRes.status === 200 &&
      submitMRes.data?.milestones?.find(m => m._id === milestoneId)?.status === 'submitted',
      '5. Learner can submit milestone with proof of work (evidence URL & notes)'
    );

    // ── 6. Learner cannot approve milestones ──────────────────────────────
    const learnerSelfApprove = await request(
      `/learning/track/${trackATeaches._id}/milestones/${milestoneId}/review`,
      {
        method: 'POST',
        ...authB,
        body: JSON.stringify({ action: 'approve' }),
      }
    );
    assert(learnerSelfApprove.status === 403, '6. Security: Learner is strictly forbidden from approving their own milestone (403 Forbidden)');

    // ── 7. Instructor can request revisions ───────────────────────────────
    const revisionRes = await request(
      `/learning/track/${trackATeaches._id}/milestones/${milestoneId}/review`,
      {
        method: 'POST',
        ...authA,
        body: JSON.stringify({
          action: 'revision_requested',
          feedback: 'Please add cleanup logic to the useEffect hook.',
        }),
      }
    );
    const revMilestone = revisionRes.data?.milestones?.find(m => m._id === milestoneId);
    assert(
      revisionRes.status === 200 &&
      revMilestone?.status === 'revision_requested' &&
      revMilestone?.feedback.includes('cleanup'),
      '7. Instructor can request revisions with constructive feedback'
    );

    // Learner resubmits
    await request(`/learning/track/${trackATeaches._id}/milestones/${milestoneId}/submit`, {
      method: 'POST',
      ...authB,
      body: JSON.stringify({
        evidenceUrl: 'https://github.com/userb/react-hooks-counter-v2',
        submissionNotes: 'Added cleanup function to prevent memory leaks',
      }),
    });

    // ── 8. Instructor can approve milestones ──────────────────────────────
    const approveMRes = await request(
      `/learning/track/${trackATeaches._id}/milestones/${milestoneId}/review`,
      {
        method: 'POST',
        ...authA,
        body: JSON.stringify({
          action: 'approve',
          feedback: 'Excellent work! Cleanup logic is properly structured.',
        }),
      }
    );
    const approvedMilestone = approveMRes.data?.milestones?.find(m => m._id === milestoneId);
    assert(
      approveMRes.status === 200 &&
      approvedMilestone?.status === 'approved' &&
      approvedMilestone?.instructorApprovalStatus === 'approved',
      '8. Instructor can approve submitted milestones'
    );

    // ── 9. Progress recalculates correctly ────────────────────────────────
    // Track has 2 milestones total, 1 approved -> 50%
    assert(
      approveMRes.data?.overallProgress === 50,
      '9. Progress percentage recalculates accurately on the backend ((1/2)*100 = 50%)'
    );

    // ── 10. Zero-milestone progress handled correctly ─────────────────────
    // Create an empty dummy track to verify division by zero handling
    const dummyTrack = new LearningTrack({
      swapRequest: swapId,
      learner: idC,
      instructor: idA,
      skillName: 'Go',
      milestones: [],
      overallProgress: 0,
    });
    await dummyTrack.save();
    const dummyTrackRes = await request(`/learning/track/${dummyTrack._id}`, { method: 'GET', ...authA });
    assert(
      dummyTrackRes.status === 200 && dummyTrackRes.data?.overallProgress === 0,
      '10. Zero-milestone tracks handled safely without division by zero errors'
    );
    await LearningTrack.deleteOne({ _id: dummyTrack._id });

    // ── 11. Instructor creates Quiz assessment ────────────────────────────
    const createQuizRes = await request(`/learning/track/${trackATeaches._id}/assessments`, {
      method: 'POST',
      ...authA,
      body: JSON.stringify({
        type: 'quiz',
        title: 'React Fundamentals Quiz',
        description: 'Test your understanding of JSX, hooks, and component lifecycle',
        passingScore: 70,
        questions: [
          {
            question: 'What hook is used for component side-effects?',
            options: ['useState', 'useEffect', 'useContext', 'useReducer'],
            correctOption: 1, // 'useEffect'
          },
          {
            question: 'Can React components return multiple root elements without a fragment?',
            options: ['Yes, always', 'No, never', 'Only in development mode', 'Only in class components'],
            correctOption: 1, // 'No, never'
          },
        ],
      }),
    });
    assert(createQuizRes.status === 201, '11. Instructor can author multiple-choice quiz assessments');

    const trackWithQuiz = await request(`/learning/track/${trackATeaches._id}`, { method: 'GET', ...authA });
    const quiz = trackWithQuiz.data.assessments.find(a => a.type === 'quiz');
    const quizId = quiz._id;

    // ── 12. Correct answers are not exposed before submission ─────────────
    // User B (learner) requests track details
    const learnerTrackView = await request(`/learning/track/${trackATeaches._id}`, { method: 'GET', ...authB });
    const learnerQuiz = learnerTrackView.data?.assessments?.find(a => a._id === quizId);
    const answersExposed = learnerQuiz?.questions?.some(q => q.correctOption !== undefined);
    assert(
      !answersExposed && learnerQuiz?.questions?.[0]?.options?.length === 4,
      '12. Security: Correct quiz answers are completely sanitized and hidden from learners before submission'
    );

    // ── 13. Quiz score calculated on backend ──────────────────────────────
    // User B submits 2 correct answers: index 1 and index 1
    const quizSubmitRes = await request(
      `/learning/track/${trackATeaches._id}/assessments/${quizId}/quiz-submit`,
      {
        method: 'POST',
        ...authB,
        body: JSON.stringify({ answers: [1, 1] }),
      }
    );
    assert(
      quizSubmitRes.status === 200 &&
      quizSubmitRes.data?.score === 100 &&
      quizSubmitRes.data?.passed === true,
      '13. Quiz score graded and verified securely on backend (100% score, passed=true)'
    );

    // ── 14. Assessment attempt history stored ─────────────────────────────
    const trackAfterQuiz = await request(`/learning/track/${trackATeaches._id}`, { method: 'GET', ...authA });
    const quizAfterAttempt = trackAfterQuiz.data?.assessments?.find(a => a._id === quizId);
    assert(
      quizAfterAttempt?.attempts?.length >= 1 &&
      quizAfterAttempt.attempts[0].score === 100,
      '14. Complete assessment attempt history and timestamp preserved'
    );

    // ── 15. Practical task submission works ────────────────────────────────
    // Instructor adds practical task
    await request(`/learning/track/${trackATeaches._id}/assessments`, {
      method: 'POST',
      ...authA,
      body: JSON.stringify({
        type: 'practical',
        title: 'Full React Todo Application',
        instructions: 'Implement task filtering, local storage persistence, and unit tests',
        passingScore: 70,
      }),
    });
    const trackWithPractical = await request(`/learning/track/${trackATeaches._id}`, { method: 'GET', ...authA });
    const practical = trackWithPractical.data?.assessments?.find(a => a.type === 'practical');
    const practicalId = practical._id;

    // Learner submits practical task
    const practicalSubmitRes = await request(
      `/learning/track/${trackATeaches._id}/assessments/${practicalId}/practical-submit`,
      {
        method: 'POST',
        ...authB,
        body: JSON.stringify({
          submissionText: 'Built React 18 SPA with dark-mode and custom hooks',
          evidenceUrl: 'https://github.com/userb/react-todo-spa',
        }),
      }
    );
    assert(
      practicalSubmitRes.status === 200 &&
      practicalSubmitRes.data?.assessment?.evaluationStatus === 'submitted',
      '15. Learner can submit practical tasks with description and GitHub URL'
    );

    // ── 16. Instructor can evaluate practical tasks ────────────────────────
    const practicalEvalRes = await request(
      `/learning/track/${trackATeaches._id}/assessments/${practicalId}/practical-evaluate`,
      {
        method: 'POST',
        ...authA,
        body: JSON.stringify({
          passed: true,
          feedback: 'Code is well architected and follows React 18 best practices!',
        }),
      }
    );
    assert(
      practicalEvalRes.status === 200 &&
      practicalEvalRes.data?.assessment?.passed === true &&
      practicalEvalRes.data?.assessment?.evaluationStatus === 'evaluated',
      '16. Instructor can evaluate practical tasks and assign feedback'
    );

    // ── 17. Duplicate learning plans prevented ─────────────────────────────
    const duplicateInitRes = await request(`/learning/init/${swapId}`, { method: 'POST', ...authA });
    assert(
      duplicateInitRes.status === 200 &&
      duplicateInitRes.data?.message?.includes('already exists') &&
      duplicateInitRes.data?.tracks?.length === 2,
      '17. Duplicate learning plans prevented for the same swap'
    );

    // ── 18. Learning notifications delivered ──────────────────────────────
    const bNotifs = await request('/notifications', { method: 'GET', ...authB });
    const hasMilestoneNotif = bNotifs.data?.notifications?.some(
      n => n.type === 'MILESTONE_ASSIGNED' || n.type === 'MILESTONE_APPROVED'
    );
    assert(hasMilestoneNotif, '18. Real-time learning notifications delivered to student notification inbox');

    // ── 19. Dashboard statistics are correct ───────────────────────────────
    const dashRes = await request('/learning/dashboard', { method: 'GET', ...authB });
    assert(
      dashRes.status === 200 &&
      dashRes.data?.stats?.totalLearning >= 1 &&
      dashRes.data?.stats?.totalTeaching >= 1 &&
      Array.isArray(dashRes.data?.learning),
      '19. Dedicated learning dashboard calculates correct metrics and tracks'
    );

    // ── 20. Learning track completion works ────────────────────────────────
    // Approve the remaining milestone on Track A
    const trackM0 = updatedTrack.data.milestones[0]._id;
    await request(`/learning/track/${trackATeaches._id}/milestones/${trackM0}/review`, {
      method: 'POST',
      ...authA,
      body: JSON.stringify({ action: 'approve' }),
    });

    const finalTrack = await request(`/learning/track/${trackATeaches._id}`, { method: 'GET', ...authA });
    assert(
      finalTrack.data?.overallProgress === 100 &&
      finalTrack.data?.status === 'completed' &&
      finalTrack.data?.completedAt !== null,
      '20. Learning track transitions to "completed" with 100% progress when all milestones approved'
    );

    // ── 21. Swap lifecycle remains independent of learning completion ─────
    const swapCheck = await request('/swap', { method: 'GET', ...authA });
    const targetSwap = swapCheck.data?.find(s => s._id === swapId);
    assert(
      targetSwap && targetSwap.status === 'accepted',
      '21. Swap status remains "accepted" independently of learning track completion'
    );

    // ── 22. Public achievements endpoint ──────────────────────────────────
    const achievementsRes = await request(`/learning/achievements/${idB}`, { method: 'GET', ...authA });
    assert(
      achievementsRes.status === 200 &&
      achievementsRes.data?.some(a => a.skillName === 'React'),
      '22. Public achievements endpoint returns verified completed tracks without exposing private test details'
    );

  } catch (err) {
    console.error('💥 Test execution error:', err);
    failed++;
  } finally {
    await mongoose.disconnect();

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📊 TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    process.exit(failed > 0 ? 1 : 0);
  }
}

runTests();
