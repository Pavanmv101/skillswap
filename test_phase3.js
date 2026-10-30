const mongoose = require('mongoose');
const { io } = require('/Users/pavanmv/Downloads/frontend/node_modules/socket.io-client');
const User = require('./models/User');
const SwapRequest = require('./models/SwapRequest');
const SkillVerification = require('./models/SkillVerification');
const Endorsement = require('./models/Endorsement');
const Notification = require('./models/Notification');

const BASE_URL = 'http://localhost:5001/api';
const SOCKET_URL = 'http://localhost:5001';
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
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🧪 SKILLSWAP PHASE 3 — SKILL VERIFICATION & TRUST SYSTEM QA SUITE');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

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

  const socketsToClose = [];

  try {
    await mongoose.connect(MONGO_URI);

    const ts = Date.now();
    const student1Email = `s1_${ts}@test.edu`;
    const student2Email = `s2_${ts}@test.edu`;
    const student3Email = `s3_${ts}@test.edu`;

    // ── 1. Create Test Students ───────────────────────────────────────────
    const regS1 = await request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: 'Student One', email: student1Email, password: 'password123' }),
    });
    const s1Token = regS1.data.token;
    const s1Id    = regS1.data.user.id;
    const s1Auth  = { headers: { Authorization: `Bearer ${s1Token}` } };

    const regS2 = await request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: 'Student Two', email: student2Email, password: 'password123' }),
    });
    const s2Token = regS2.data.token;
    const s2Id    = regS2.data.user.id;
    const s2Auth  = { headers: { Authorization: `Bearer ${s2Token}` } };

    const regS3 = await request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name: 'Student Three', email: student3Email, password: 'password123' }),
    });
    const s3Token = regS3.data.token;
    const s3Id    = regS3.data.user.id;
    const s3Auth  = { headers: { Authorization: `Bearer ${s3Token}` } };

    // Setup skills
    await request('/profile', {
      method: 'PUT',
      ...s1Auth,
      body: JSON.stringify({
        skillsOffered: [
          { skill: 'React', category: 'Programming', level: 'Advanced' },
          { skill: 'Node.js', category: 'Programming', level: 'Intermediate' },
        ],
        skillsWanted: [{ skill: 'Python', category: 'Programming', priority: 'High' }],
      }),
    });

    await request('/profile', {
      method: 'PUT',
      ...s2Auth,
      body: JSON.stringify({
        skillsOffered: [{ skill: 'Python', category: 'Programming', level: 'Advanced' }],
        skillsWanted: [{ skill: 'React', category: 'Programming', priority: 'High' }],
      }),
    });

    // ── 2. Admin Authentication Setup ─────────────────────────────────────
    const adminLogin = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'admin@skillswap.com', password: 'password123' }),
    });
    const adminToken = adminLogin.data?.token;
    const adminAuth = { headers: { Authorization: `Bearer ${adminToken}` } };
    assert(adminLogin.status === 200 && adminLogin.data?.user?.role === 'admin', 'Admin logs in successfully with seeded credentials and role=admin');

    // ── 3. Test Student 1 Submits Certificate Evidence (Base64 PDF) ───────
    // Valid minimal PDF header %PDF-1.4
    const validPdfBase64 = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF').toString('base64');
    
    const certSubRes = await request('/verification', {
      method: 'POST',
      ...s1Auth,
      body: JSON.stringify({
        skillName: 'React',
        category: 'Programming',
        evidenceType: 'certificate',
        certificateBase64: validPdfBase64,
        certificateMime: 'application/pdf',
        description: 'Certified React Developer Certificate from Coursera',
      }),
    });
    const certVerifId = certSubRes.data?._id;
    assert(certSubRes.status === 201 && certSubRes.data?.status === 'pending' && certVerifId, 'Student submits certificate evidence (base64 PDF decoded and saved in private storage)');

    // ── 4. Test Student 1 Submits GitHub Evidence ─────────────────────────
    const ghSubRes = await request('/verification', {
      method: 'POST',
      ...s1Auth,
      body: JSON.stringify({
        skillName: 'Node.js',
        category: 'Programming',
        evidenceType: 'github',
        evidenceUrl: 'https://github.com/studentone/mern-skillswap-backend',
        description: 'Built RESTful API with MongoDB, Express, and JWT Authentication',
      }),
    });
    const ghVerifId = ghSubRes.data?._id;
    assert(ghSubRes.status === 201 && ghSubRes.data?.evidenceUrl?.includes('github.com'), 'Student submits GitHub URL evidence with URL validation');

    // ── 5. Test Pending Status Displayed in Student View ──────────────────
    const myVerifRes = await request('/verification/my', {
      method: 'GET',
      ...s1Auth,
    });
    assert(
      myVerifRes.status === 200 &&
      myVerifRes.data.length >= 2 &&
      myVerifRes.data.some(v => v.skillName === 'React' && v.status === 'pending'),
      'Student can view pending verification submissions with correct status'
    );

    // ── 6. Security: Non-Admin Cannot Access Admin Routes ─────────────────
    const s1AdminAttempt = await request('/admin/verifications', {
      method: 'GET',
      ...s1Auth,
    });
    assert(s1AdminAttempt.status === 403, 'Non-admin student is blocked from GET /api/admin/verifications (403 Forbidden)');

    // ── 7. Security: Student Cannot Approve Own Verification ──────────────
    const s1SelfApprove = await request(`/admin/verifications/${certVerifId}/approve`, {
      method: 'POST',
      ...s1Auth,
    });
    assert(s1SelfApprove.status === 403, 'Student cannot self-approve their own verification application (403 Forbidden)');

    // ── 8. Security: Private Document Stream Verification ─────────────────
    // Admin can stream file
    const adminFileRes = await fetch(`${BASE_URL}/verification/${certVerifId}/file`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(adminFileRes.status === 200 && adminFileRes.headers.get('content-type') === 'application/pdf', 'Admin can securely preview and stream private uploaded certificate');

    // Owner (Student 1) can stream file
    const ownerFileRes = await fetch(`${BASE_URL}/verification/${certVerifId}/file`, {
      headers: { Authorization: `Bearer ${s1Token}` },
    });
    assert(ownerFileRes.status === 200, 'Document owner can securely view and stream their own uploaded certificate');

    // Unrelated Student 2 cannot stream file
    const strangerFileRes = await fetch(`${BASE_URL}/verification/${certVerifId}/file`, {
      headers: { Authorization: `Bearer ${s2Token}` },
    });
    assert(strangerFileRes.status === 403, 'Unauthorized student cannot access another user private certificate file (403 Forbidden)');

    // ── 9. Admin Approves Certificate Evidence ────────────────────────────
    const approveRes = await request(`/admin/verifications/${certVerifId}/approve`, {
      method: 'POST',
      ...adminAuth,
    });
    assert(approveRes.status === 200 && approveRes.data?.verification?.status === 'verified', 'Admin approves valid evidence submission');

    // Verify User model updated
    const s1Profile = await request('/profile', { method: 'GET', ...s1Auth });
    const reactSkill = s1Profile.data?.skillsOffered?.find(s => s.skill === 'React');
    assert(reactSkill && reactSkill.verified === true, 'Approved skill automatically gains verified: true on student profile');

    // ── 10. Admin Rejects with Mandatory Reason Validation ─────────────────
    const rejectNoReason = await request(`/admin/verifications/${ghVerifId}/reject`, {
      method: 'POST',
      ...adminAuth,
      body: JSON.stringify({}),
    });
    assert(rejectNoReason.status === 400, 'Admin rejection without mandatory reason is rejected (400 Bad Request)');

    const rejectWithReason = await request(`/admin/verifications/${ghVerifId}/reject`, {
      method: 'POST',
      ...adminAuth,
      body: JSON.stringify({ rejectionReason: 'Repository is private or lacks documentation. Please add a README.' }),
    });
    assert(rejectWithReason.status === 200 && rejectWithReason.data?.verification?.status === 'rejected', 'Admin rejects evidence with clear constructive reason');

    // ── 11. Student Views Rejection Reason & Resubmits ─────────────────────
    const myVerifAfterReject = await request('/verification/my', { method: 'GET', ...s1Auth });
    const rejectedEntry = myVerifAfterReject.data?.find(v => v.skillName === 'Node.js');
    assert(
      rejectedEntry && rejectedEntry.status === 'rejected' && rejectedEntry.rejectionReason.includes('README'),
      'Student views rejection reason in their application history'
    );

    // Resubmit
    const resubmitRes = await request('/verification', {
      method: 'POST',
      ...s1Auth,
      body: JSON.stringify({
        skillName: 'Node.js',
        category: 'Programming',
        evidenceType: 'project',
        evidenceUrl: 'https://github.com/studentone/mern-skillswap-backend-v2',
        description: 'Added detailed README and API documentation for Node.js project',
      }),
    });
    assert(resubmitRes.status === 200 && resubmitRes.data?.status === 'pending', 'Student can resubmit evidence after rejection');

    // ── 12. Verification Notifications ────────────────────────────────────
    const s1Notifs = await request('/notifications', { method: 'GET', ...s1Auth });
    const hasApprovalNotif = s1Notifs.data?.notifications?.some(
      n => n.type === 'VERIFICATION_APPROVED' && (n.message.includes('React') || n.title.includes('Verified'))
    );
    const hasRejectionNotif = s1Notifs.data?.notifications?.some(
      n => n.type === 'VERIFICATION_REJECTED' && (n.message.includes('README') || n.title.includes('Verification'))
    );
    assert(hasApprovalNotif && hasRejectionNotif, 'Admin actions deliver VERIFICATION_APPROVED and VERIFICATION_REJECTED notifications to student');

    // ── 13. Peer Skill Endorsements: Requirement Validation ───────────────
    // Student 2 attempts to endorse Student 1 BEFORE completing a swap
    const earlyEndorse = await request('/endorsements', {
      method: 'POST',
      ...s2Auth,
      body: JSON.stringify({
        recipient: s1Id,
        skillName: 'React',
        swapRequestId: new mongoose.Types.ObjectId().toString(),
        comment: 'Great peer!',
      }),
    });
    assert(earlyEndorse.status === 404 || earlyEndorse.status === 400 || earlyEndorse.status === 403, 'Non-partner without valid completed barter cannot endorse peer skill');

    // Student 1 attempts to self-endorse
    const selfEndorse = await request('/endorsements', {
      method: 'POST',
      ...s1Auth,
      body: JSON.stringify({
        recipient: s1Id,
        skillName: 'React',
        swapRequestId: new mongoose.Types.ObjectId().toString(),
      }),
    });
    assert(selfEndorse.status === 400, 'Self-endorsement is strictly forbidden (400 Bad Request)');

    // ── 14. Complete a Swap Exchange Between S1 and S2 ────────────────────
    const swapReq = await request('/swap', {
      method: 'POST',
      ...s1Auth,
      body: JSON.stringify({
        toUser: s2Id,
        offeredSkill: 'React',
        wantedSkill: 'Python',
      }),
    });
    const swapId = swapReq.data?._id;

    // S2 accepts
    await request(`/swap/${swapId}/accept`, { method: 'PUT', ...s2Auth });

    // S1 marks completion -> status completed
    const completeRes = await request(`/swap/${swapId}/complete`, { method: 'PUT', ...s1Auth });
    assert(completeRes.status === 200 && completeRes.data?.status === 'completed', 'Students successfully finish barter exchange and mark swap completed');

    // ── 15. S2 Endorses S1 React Skill Based on Completed Swap ────────────
    const endorseRes = await request('/endorsements', {
      method: 'POST',
      ...s2Auth,
      body: JSON.stringify({
        recipient: s1Id,
        skillName: 'React',
        swapRequestId: swapId,
        comment: 'Outstanding knowledge of React hooks and state management! Highly recommended.',
      }),
    });
    assert(endorseRes.status === 201 && (endorseRes.data?.skillName === 'React' || endorseRes.data?.endorsement?.skillName === 'React'), 'Completed swap partner can officially endorse peer skill');

    // ── 16. Duplicate Endorsement Prevention ──────────────────────────────
    const duplicateEndorse = await request('/endorsements', {
      method: 'POST',
      ...s2Auth,
      body: JSON.stringify({
        recipient: s1Id,
        skillName: 'React',
        swapRequestId: swapId,
      }),
    });
    assert(duplicateEndorse.status === 400, 'Duplicate peer endorsement for same skill is prevented (400 Bad Request)');

    // ── 17. Endorsement Notification Delivery ─────────────────────────────
    const s1NotifsAfterEndorse = await request('/notifications', { method: 'GET', ...s1Auth });
    const hasEndorseNotif = s1NotifsAfterEndorse.data?.notifications?.some(
      n => n.type === 'ENDORSEMENT_RECEIVED' && n.message.includes('React')
    );
    assert(hasEndorseNotif, 'Peer endorsement triggers ENDORSEMENT_RECEIVED notification for recipient');

    // ── 18. Endorsements Listing Endpoint ─────────────────────────────────
    const publicEndorsements = await request(`/endorsements/${s1Id}`, { method: 'GET', ...s1Auth });
    const endorsementsList = publicEndorsements.data?.endorsements || (Array.isArray(publicEndorsements.data) ? publicEndorsements.data : []);
    assert(
      publicEndorsements.status === 200 &&
      endorsementsList.length >= 1 &&
      endorsementsList[0].skillName === 'React' &&
      endorsementsList[0].endorser?.name === 'Student Two',
      'GET /api/endorsements/:userId returns list of verified peer endorsements with endorser details'
    );

    // ── 19. Phase 1 & 2 Regressions ───────────────────────────────────────
    // Bidirectional matching check
    const matchRes = await request('/match', { method: 'GET', ...s1Auth });
    assert(matchRes.status === 200 && Array.isArray(matchRes.data?.matches), 'Phase 1 Regression: Compatibility matching engine returns ranked matches');

    // Rating system check
    const rateRes = await request('/rating', {
      method: 'POST',
      ...s1Auth,
      body: JSON.stringify({
        swapRequestId: swapId,
        ratee: s2Id,
        score: 5,
        comment: 'Great peer exchange!',
      }),
    });
    assert(rateRes.status === 201, 'Phase 1 Regression: Post-swap rating and review submitted successfully');

    // Unread count check
    const unreadRes = await request('/notifications/unread-count', { method: 'GET', ...s1Auth });
    assert(unreadRes.status === 200 && typeof unreadRes.data?.unreadCount === 'number', 'Phase 2 Regression: Notification unread count operates correctly');

  } catch (err) {
    console.error('💥 Test execution error:', err);
    failed++;
  } finally {
    socketsToClose.forEach(s => s.close());
    await mongoose.disconnect();

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📊 TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    process.exit(failed > 0 ? 1 : 0);
  }
}

runTests();
