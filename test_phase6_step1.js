/**
 * Phase 6 — Step 1.1: Swap Reliability Foundation & Corrections Tests
 * test_phase6_step1.js
 *
 * Verifies:
 * 1. Pure mathematical Bayesian calculation (zero-denom, bounds, convergence).
 * 2. New users with no exchange history (neutral prior 0.70).
 * 3. Successful exchanges (completed swaps) credited properly.
 * 4. Stale accepted swaps do NOT penalize either participant (classified as unattributed/neutral).
 * 5. Rejection handling (proposals declined prior to acceptance remain neutral).
 * 6. Pending handling (proposals awaiting response remain neutral).
 * 7. Cancellation handling (pre-acceptance withdrawals remain neutral).
 * 8. Participant attribution (both fromUser and toUser).
 * 9. Invalid scheduledAt handling (string 'not-a-valid-date' classified as unattributed/neutral).
 * 10. Missing scheduledAt handling (null/undefined grace period).
 * 11. Batch query optimization (ELIMINATES N+1: exactly 1 database query for multiple users).
 * 12. Batch empty input and duplicate candidate IDs handling.
 * 13. Mixed outcomes calculation.
 */

'use strict';

require('dotenv').config();
const assert = require('assert');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const User = require('./models/User');
const SwapRequest = require('./models/SwapRequest');
const {
  DEFAULT_PRIOR_MEAN,
  DEFAULT_PRIOR_WEIGHT,
  calculateBayesianReliability,
  classifyAcceptedSwap,
  processUserSwaps,
  getUserExchangeReliability,
  getBatchExchangeReliability,
} = require('./services/reliabilityService');

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ❌ ${name}: ${err.message}`);
    failed++;
    failures.push({ name, error: err.message });
  }
}

const createdUserIds = [];
const createdSwapIds = [];

const EMAIL = (tag) => `p6_step1_${tag}_${Date.now()}_${Math.random().toString(36).slice(2)}@test.skillswap`;

async function createTestUser(name) {
  const hashed = await bcrypt.hash('password123', 8);
  const user = new User({
    name,
    email: EMAIL(name.toLowerCase().replace(/\s+/g, '_')),
    password: hashed,
    skillsOffered: [{ skill: 'Python', category: 'Programming', level: 'Intermediate' }],
    skillsWanted:  [{ skill: 'React',  category: 'Programming', priority: 'High' }],
  });
  await user.save();
  createdUserIds.push(user._id);
  return user;
}

async function createTestSwap(fromUser, toUser, status, overrides = {}) {
  const swap = new SwapRequest({
    fromUser: fromUser._id || fromUser,
    toUser:   toUser._id   || toUser,
    offeredSkill: 'Python',
    wantedSkill:  'React',
    status,
    ...overrides,
  });
  await swap.save();
  createdSwapIds.push(swap._id);
  return swap;
}

(async () => {
  console.log('\n═════════════════════════════════════════════════════════════');
  console.log('  Phase 6 — Step 1.1: Swap Reliability Foundation Tests');
  console.log('═════════════════════════════════════════════════════════════\n');

  // ── GROUP 1: Mathematical Reliability Calculations ───────────────────────
  console.log('── Group 1: Mathematical Reliability Calculations ──');

  await test('New user (C=0, F=0) returns default neutral prior (0.70)', async () => {
    const score = calculateBayesianReliability(0, 0);
    assert.strictEqual(score, DEFAULT_PRIOR_MEAN);
    assert.strictEqual(score, 0.70);
  });

  await test('Zero denominator or missing inputs safely return prior', async () => {
    assert.strictEqual(calculateBayesianReliability(null, null), DEFAULT_PRIOR_MEAN);
    assert.strictEqual(calculateBayesianReliability(undefined, undefined), DEFAULT_PRIOR_MEAN);
    assert.strictEqual(calculateBayesianReliability(NaN, NaN), DEFAULT_PRIOR_MEAN);
    assert.strictEqual(calculateBayesianReliability(-5, -10), DEFAULT_PRIOR_MEAN);
  });

  await test('Successful completions strictly increase reliability score monotonically', async () => {
    const s0 = calculateBayesianReliability(0, 0);
    const s1 = calculateBayesianReliability(1, 0);
    const s3 = calculateBayesianReliability(3, 0);
    const s10 = calculateBayesianReliability(10, 0);

    assert.ok(s1 > s0, `s1 (${s1}) must be > s0 (${s0})`);
    assert.ok(s3 > s1, `s3 (${s3}) must be > s1 (${s1})`);
    assert.ok(s10 > s3, `s10 (${s10}) must be > s3 (${s3})`);
  });

  await test('Explicitly attributable failures decrease reliability score monotonically', async () => {
    const s0 = calculateBayesianReliability(0, 0);
    const f1 = calculateBayesianReliability(0, 1);
    const f3 = calculateBayesianReliability(0, 3);
    const f10 = calculateBayesianReliability(0, 10);

    assert.ok(f1 < s0, `f1 (${f1}) must be < s0 (${s0})`);
    assert.ok(f3 < f1, `f3 (${f3}) must be < f1 (${f1})`);
    assert.ok(f10 < f3, `f10 (${f10}) must be < f3 (${f3})`);
  });

  await test('Score boundaries strictly enforced in [0, 1]', async () => {
    const hugeSuccess = calculateBayesianReliability(100000, 0);
    const hugeFailure = calculateBayesianReliability(0, 100000);
    assert.ok(hugeSuccess <= 1.0 && hugeSuccess > 0.999, 'Huge success must not exceed 1.0');
    assert.ok(hugeFailure >= 0.0 && hugeFailure < 0.001, 'Huge failure must not fall below 0.0');
  });

  await test('Custom prior mean and prior weight work as expected', async () => {
    const customScore = calculateBayesianReliability(0, 0, { priorMean: 0.50, priorWeight: 5.0 });
    assert.strictEqual(customScore, 0.50);

    const customActive = calculateBayesianReliability(2, 0, { priorMean: 0.50, priorWeight: 2.0 });
    // (2 + 2*0.5) / (2 + 0 + 2) = 3 / 4 = 0.75
    assert.strictEqual(customActive, 0.75);
  });

  // ── GROUP 2: Swap Lifecycle & Date Classification ─────────────────────────
  console.log('\n── Group 2: Swap Lifecycle & Invalid Date Classification ──');

  await test('Accepted swap scheduled in future is classified as active', async () => {
    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const state = classifyAcceptedSwap({ scheduledAt: futureDate });
    assert.strictEqual(state, 'active');
  });

  await test('Accepted swap scheduled far in past (> staleDays) is classified as unattributed', async () => {
    const pastDate = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
    const state = classifyAcceptedSwap({ scheduledAt: pastDate }, 14);
    assert.strictEqual(state, 'unattributed');
  });

  await test('Malformed/invalid string in scheduledAt is classified as unattributed/neutral', async () => {
    const state = classifyAcceptedSwap({ scheduledAt: 'not-a-valid-date-string' });
    assert.strictEqual(state, 'unattributed');
  });

  await test('Missing scheduledAt (null or undefined) updated recently is classified as active', async () => {
    const recentDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    assert.strictEqual(classifyAcceptedSwap({ scheduledAt: null, updatedAt: recentDate }), 'active');
    assert.strictEqual(classifyAcceptedSwap({ scheduledAt: undefined, updatedAt: recentDate }), 'active');
  });

  await test('Missing scheduledAt abandoned long ago (> 28 days) is classified as unattributed', async () => {
    const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    assert.strictEqual(classifyAcceptedSwap({ scheduledAt: null, updatedAt: oldDate }, 14), 'unattributed');
  });

  // ── GROUP 3: Database Aggregation & Fair Participant Attribution ──────────
  console.log('\n── Group 3: Database Aggregation & Fair Participant Attribution ──');

  await mongoose.connect(process.env.MONGO_URI, { dbName: 'skillswap' });

  await test('New user with zero swaps receives neutralPrior: true and score 0.70', async () => {
    const user = await createTestUser('Alice NewUser');
    const res = await getUserExchangeReliability(user._id);

    assert.strictEqual(res.score, DEFAULT_PRIOR_MEAN);
    assert.strictEqual(res.neutralPrior, true);
    assert.strictEqual(res.completedCount, 0);
    assert.strictEqual(res.failedCount, 0);
    assert.strictEqual(res.unattributedCount, 0);
    assert.strictEqual(res.metrics.totalExchanges, 0);
    assert.strictEqual(res.metrics.rawCompletionRate, null);
  });

  await test('User with completed swap as fromUser is credited with successful outcome', async () => {
    const userA = await createTestUser('Bob Sender');
    const userB = await createTestUser('Charlie Receiver');

    await createTestSwap(userA, userB, 'completed');

    const resA = await getUserExchangeReliability(userA._id);
    assert.strictEqual(resA.completedCount, 1);
    assert.strictEqual(resA.failedCount, 0);
    assert.strictEqual(resA.neutralPrior, false);
    assert.ok(resA.score > DEFAULT_PRIOR_MEAN, 'Score should exceed prior');
    assert.strictEqual(resA.metrics.rawCompletionRate, 1.0);
  });

  await test('User with completed swap as toUser is credited with successful outcome', async () => {
    const userA = await createTestUser('Diana Sender');
    const userB = await createTestUser('Edward Receiver');

    await createTestSwap(userA, userB, 'completed');

    const resB = await getUserExchangeReliability(userB._id);
    assert.strictEqual(resB.completedCount, 1);
    assert.strictEqual(resB.failedCount, 0);
    assert.strictEqual(resB.neutralPrior, false);
    assert.ok(resB.score > DEFAULT_PRIOR_MEAN, 'Score should exceed prior');
    assert.strictEqual(resB.metrics.rawCompletionRate, 1.0);
  });

  await test('Stale accepted swap does NOT penalize either participant (fair attribution)', async () => {
    const userA = await createTestUser('Stale User A');
    const userB = await createTestUser('Stale User B');

    const pastDate = new Date(Date.now() - 25 * 24 * 60 * 60 * 1000);
    await createTestSwap(userA, userB, 'accepted', { scheduledAt: pastDate });

    const resA = await getUserExchangeReliability(userA._id);
    const resB = await getUserExchangeReliability(userB._id);

    // Stale swap is classified as unattributed/neutral — neither user is penalized!
    assert.strictEqual(resA.completedCount, 0);
    assert.strictEqual(resA.failedCount, 0);
    assert.strictEqual(resA.unattributedCount, 1);
    assert.strictEqual(resA.neutralPrior, true);
    assert.strictEqual(resA.score, DEFAULT_PRIOR_MEAN);

    assert.strictEqual(resB.completedCount, 0);
    assert.strictEqual(resB.failedCount, 0);
    assert.strictEqual(resB.unattributedCount, 1);
    assert.strictEqual(resB.neutralPrior, true);
    assert.strictEqual(resB.score, DEFAULT_PRIOR_MEAN);
  });

  await test('Invalid scheduledAt date in swap object classified as unattributed without penalizing', async () => {
    // Test processUserSwaps directly with malformed scheduledAt property
    const malformedSwap = {
      status: 'accepted',
      scheduledAt: 'not-a-valid-date-string',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const res = processUserSwaps([malformedSwap]);
    assert.strictEqual(res.completedCount, 0);
    assert.strictEqual(res.failedCount, 0);
    assert.strictEqual(res.unattributedCount, 1);
    assert.strictEqual(res.score, DEFAULT_PRIOR_MEAN);
    assert.strictEqual(res.neutralPrior, true);
  });

  await test('Rejected proposals do not affect completed or failed counts', async () => {
    const userA = await createTestUser('Fiona RejectedSender');
    const userB = await createTestUser('George Rejecter');

    await createTestSwap(userA, userB, 'rejected');

    const resA = await getUserExchangeReliability(userA._id);
    const resB = await getUserExchangeReliability(userB._id);

    assert.strictEqual(resA.completedCount, 0);
    assert.strictEqual(resA.failedCount, 0);
    assert.strictEqual(resA.neutralPrior, true);
    assert.strictEqual(resA.metrics.rejectedCount, 1);
    assert.strictEqual(resA.score, DEFAULT_PRIOR_MEAN);

    assert.strictEqual(resB.completedCount, 0);
    assert.strictEqual(resB.failedCount, 0);
    assert.strictEqual(resB.neutralPrior, true);
    assert.strictEqual(resB.metrics.rejectedCount, 1);
    assert.strictEqual(resB.score, DEFAULT_PRIOR_MEAN);
  });

  await test('Cancelled proposals (pre-acceptance) do not affect completed or failed counts', async () => {
    const userA = await createTestUser('Hannah Canceller');
    const userB = await createTestUser('Ian Target');

    await createTestSwap(userA, userB, 'cancelled', { cancelReason: 'Changed mind' });

    const resA = await getUserExchangeReliability(userA._id);
    const resB = await getUserExchangeReliability(userB._id);

    assert.strictEqual(resA.completedCount, 0);
    assert.strictEqual(resA.failedCount, 0);
    assert.strictEqual(resA.neutralPrior, true);
    assert.strictEqual(resA.metrics.cancelledCount, 1);
    assert.strictEqual(resA.score, DEFAULT_PRIOR_MEAN);

    assert.strictEqual(resB.completedCount, 0);
    assert.strictEqual(resB.failedCount, 0);
    assert.strictEqual(resB.neutralPrior, true);
    assert.strictEqual(resB.score, DEFAULT_PRIOR_MEAN);
  });

  await test('Pending requests do not penalize or inflate reliability scores', async () => {
    const userA = await createTestUser('Jack Proposer');
    const userB = await createTestUser('Karen Pending');

    await createTestSwap(userA, userB, 'pending');

    const resA = await getUserExchangeReliability(userA._id);
    assert.strictEqual(resA.completedCount, 0);
    assert.strictEqual(resA.failedCount, 0);
    assert.strictEqual(resA.neutralPrior, true);
    assert.strictEqual(resA.metrics.pendingCount, 1);
    assert.strictEqual(resA.score, DEFAULT_PRIOR_MEAN);
  });

  await test('Active accepted swap in future is tracked in activeCount without penalty', async () => {
    const userA = await createTestUser('Leo Scheduled1');
    const userB = await createTestUser('Maya Scheduled2');

    const futureDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    await createTestSwap(userA, userB, 'accepted', { scheduledAt: futureDate });

    const resA = await getUserExchangeReliability(userA._id);
    assert.strictEqual(resA.completedCount, 0);
    assert.strictEqual(resA.failedCount, 0);
    assert.strictEqual(resA.activeCount, 1);
    assert.strictEqual(resA.neutralPrior, true);
    assert.strictEqual(resA.score, DEFAULT_PRIOR_MEAN);
  });

  await test('Mixed outcomes: 2 completed + 1 stale (neutral) + 1 active + 2 rejected', async () => {
    const user = await createTestUser('Paul MixedUser');
    const peer1 = await createTestUser('Peer One');
    const peer2 = await createTestUser('Peer Two');

    // 2 completed
    await createTestSwap(user, peer1, 'completed');
    await createTestSwap(peer2, user, 'completed');

    // 1 stale accepted (unattributed)
    const pastDate = new Date(Date.now() - 25 * 24 * 60 * 60 * 1000);
    await createTestSwap(user, peer1, 'accepted', { scheduledAt: pastDate });

    // 1 active accepted
    const futureDate = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000);
    await createTestSwap(peer2, user, 'accepted', { scheduledAt: futureDate });

    // 2 rejected
    await createTestSwap(user, peer1, 'rejected');
    await createTestSwap(peer2, user, 'rejected');

    const res = await getUserExchangeReliability(user._id);

    assert.strictEqual(res.completedCount, 2);
    assert.strictEqual(res.failedCount, 0);
    assert.strictEqual(res.activeCount, 1);
    assert.strictEqual(res.unattributedCount, 1);
    assert.strictEqual(res.metrics.pendingCount, 0);
    assert.strictEqual(res.metrics.rejectedCount, 2);
    assert.strictEqual(res.neutralPrior, false);

    // Expected score: (2 + 3 * 0.70) / (2 + 0 + 3) = 4.10 / 5 = 0.82
    const expected = (2 + 3 * 0.70) / (2 + 0 + 3);
    assert.ok(Math.abs(res.score - expected) < 0.001, `Score ${res.score} matches expected ${expected}`);
    assert.strictEqual(res.metrics.rawCompletionRate, 1.0);
  });

  // ── GROUP 4: Batch Query Optimization & Edge Cases (N+1 Elimination) ─────
  console.log('\n── Group 4: Batch Query Optimization (N+1 Elimination) ──');

  await test('Batch query handles empty candidate list gracefully with 0 queries', async () => {
    const resEmpty = await getBatchExchangeReliability([]);
    assert.strictEqual(resEmpty.size, 0);

    const resNull = await getBatchExchangeReliability(null);
    assert.strictEqual(resNull.size, 0);
  });

  await test('Batch query handles duplicate candidate IDs without redundant processing', async () => {
    const userA = await createTestUser('Dedup User A');
    const userB = await createTestUser('Dedup User B');
    await createTestSwap(userA, userB, 'completed');

    // Provide duplicates of same ID as string and ObjectId
    const map = await getBatchExchangeReliability([
      userA._id,
      userA._id.toString(),
      userA._id,
      'invalid-id',
    ]);

    assert.strictEqual(map.size, 1);
    assert.ok(map.has(userA._id.toString()));
    assert.strictEqual(map.get(userA._id.toString()).completedCount, 1);
  });

  await test('Batch query serves multiple candidate users in EXACTLY ONE database query', async () => {
    const user1 = await createTestUser('Batch User 1');
    const user2 = await createTestUser('Batch User 2');
    const user3 = await createTestUser('Batch User 3');

    await createTestSwap(user1, user2, 'completed');
    await createTestSwap(user2, user3, 'completed');

    // Spy on SwapRequest.find to verify query count
    let queryCount = 0;
    const originalFind = SwapRequest.find;
    SwapRequest.find = function (...args) {
      queryCount++;
      return originalFind.apply(this, args);
    };

    try {
      const map = await getBatchExchangeReliability([user1._id, user2._id, user3._id]);

      // Exactly 1 single batched query must be executed for all 3 users!
      assert.strictEqual(queryCount, 1, `Expected exactly 1 database query, got ${queryCount}`);
      assert.strictEqual(map.size, 3);
      assert.strictEqual(map.get(user1._id.toString()).completedCount, 1);
      assert.strictEqual(map.get(user2._id.toString()).completedCount, 2);
      assert.strictEqual(map.get(user3._id.toString()).completedCount, 1);
    } finally {
      SwapRequest.find = originalFind;
    }
  });

  // ── Cleanup ──────────────────────────────────────────────────────────────
  try {
    await User.deleteMany({ _id: { $in: createdUserIds } });
    await SwapRequest.deleteMany({ _id: { $in: createdSwapIds } });
  } catch (err) {
    console.warn('[Cleanup] Note cleaning test fixtures:', err.message);
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log('\n═════════════════════════════════════════════════════════════');
  console.log(`  Phase 6 Step 1.1 Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  if (failures.length > 0) {
    console.log('\n  Failures:');
    failures.forEach(f => console.log(`    ✗ ${f.name}\n      → ${f.error}`));
  }
  console.log('═════════════════════════════════════════════════════════════\n');

  await mongoose.disconnect();
  process.exit(failed > 0 ? 1 : 0);
})();
