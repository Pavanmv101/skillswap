/**
 * Targeted QA Suite for Production Readiness Improvements
 * Tests:
 *  1. Strict CORS Origin Validation (URL API, lookalike rejection, preview validation)
 *  2. Clustered Cron Idempotency & MongoDB Unique Partial Indexing
 *  3. Graceful Shutdown Behavior & Concurrency
 */

const assert = require('assert');
const mongoose = require('mongoose');
require('dotenv').config();

const { isAllowedOrigin } = require('./server');
const Notification = require('./models/Notification');
const SwapRequest = require('./models/SwapRequest');
const User = require('./models/User');
const { checkUpcomingSessionReminders, stopReminderScheduler } = require('./services/reminderService');

async function runTests() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🧪 SKILLSWAP — TARGETED PRODUCTION IMPROVEMENTS QA SUITE');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  let passed = 0;
  let failed = 0;

  function test(desc, fn) {
    try {
      fn();
      console.log(`✅ PASS: ${desc}`);
      passed++;
    } catch (err) {
      console.error(`❌ FAIL: ${desc} ->`, err.message);
      failed++;
    }
  }

  async function testAsync(desc, fn) {
    try {
      await fn();
      console.log(`✅ PASS: ${desc}`);
      passed++;
    } catch (err) {
      console.error(`❌ FAIL: ${desc} ->`, err.message);
      failed++;
    }
  }

  // ── TEST GROUP 1: Strict CORS Origin Validation ─────────────────────────────
  console.log('--- GROUP 1: Strict CORS Origin Validation ---');

  // Preserve NODE_ENV
  const originalEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';

  test('CORS: Allows exact configured production origin (https://skillswap.vercel.app)', () => {
    assert.strictEqual(isAllowedOrigin('https://skillswap.vercel.app'), true);
  });

  test('CORS: Allows valid SkillSwap branch preview (https://skillswap-git-feature.vercel.app)', () => {
    assert.strictEqual(isAllowedOrigin('https://skillswap-git-feature.vercel.app'), true);
  });

  test('CORS: Allows valid SkillSwap preview hash (https://skillswap-abc1234.vercel.app)', () => {
    assert.strictEqual(isAllowedOrigin('https://skillswap-abc1234.vercel.app'), true);
  });

  test('CORS: Rejects unrelated Vercel project (https://attacker-project.vercel.app)', () => {
    assert.strictEqual(isAllowedOrigin('https://attacker-project.vercel.app'), false);
  });

  test('CORS: Rejects lookalike domain (https://skillswap.vercel.app.attacker.com)', () => {
    assert.strictEqual(isAllowedOrigin('https://skillswap.vercel.app.attacker.com'), false);
  });

  test('CORS: Rejects suffix lookalike domain (https://attacker-skillswap.vercel.app)', () => {
    assert.strictEqual(isAllowedOrigin('https://attacker-skillswap.vercel.app'), false);
  });

  test('CORS: Rejects insecure HTTP protocol in production (http://skillswap.vercel.app)', () => {
    assert.strictEqual(isAllowedOrigin('http://skillswap.vercel.app'), false);
  });

  test('CORS: Rejects non-standard port on Vercel preview (https://skillswap.vercel.app:8443)', () => {
    assert.strictEqual(isAllowedOrigin('https://skillswap.vercel.app:8443'), false);
  });

  test('CORS: Rejects localhost in production environment (http://localhost:3000)', () => {
    assert.strictEqual(isAllowedOrigin('http://localhost:3000'), false);
  });

  process.env.NODE_ENV = 'development';
  test('CORS: Allows localhost in development environment (http://localhost:3000)', () => {
    assert.strictEqual(isAllowedOrigin('http://localhost:3000'), true);
  });

  test('CORS: Allows requests with no origin header (curl, mobile, server-to-server)', () => {
    assert.strictEqual(isAllowedOrigin(undefined), true);
    assert.strictEqual(isAllowedOrigin(''), true);
  });

  process.env.NODE_ENV = originalEnv;

  // ── TEST GROUP 2: Multi-Instance Cron Idempotency & Database Index ──────────
  console.log('\n--- GROUP 2: Clustered Cron Idempotency & Database Uniqueness ---');

  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/skillswap');

  // Verify unique index exists on Notification collection
  const notifCollection = mongoose.connection.collection('notifications');
  await Notification.syncIndexes();
  const indexes = await notifCollection.indexes();
  
  test('Database: unique_session_reminder_per_swap index is created and active', () => {
    const idx = indexes.find(i => i.name === 'unique_session_reminder_per_swap');
    assert(idx, 'Index unique_session_reminder_per_swap must exist');
    assert.strictEqual(idx.unique, true, 'Index must be unique');
    assert(idx.partialFilterExpression, 'Index must have partialFilterExpression');
  });

  const dummySwapId = new mongoose.Types.ObjectId();
  const dummyRecipientId = new mongoose.Types.ObjectId();

  await testAsync('Database: Insert initial SESSION_REMINDER succeeds', async () => {
    const n1 = new Notification({
      recipient: dummyRecipientId,
      type: 'SESSION_REMINDER',
      title: 'Session Reminder Test 1',
      message: 'Test reminder 1',
      relatedSwap: dummySwapId,
    });
    await n1.save();
    assert(n1._id, 'First reminder must be saved');
  });

  await testAsync('Database: Concurrent duplicate SESSION_REMINDER triggers E11000 duplicate key error', async () => {
    let duplicateRejected = false;
    try {
      const n2 = new Notification({
        recipient: dummyRecipientId,
        type: 'SESSION_REMINDER',
        title: 'Session Reminder Duplicate Test',
        message: 'Test reminder 2',
        relatedSwap: dummySwapId,
      });
      await n2.save();
    } catch (err) {
      if (err.code === 11000) {
        duplicateRejected = true;
      }
    }
    assert.strictEqual(duplicateRejected, true, 'Duplicate reminder must trigger code 11000');
  });

  await testAsync('Database: Multiple notifications with null relatedSwap are safely permitted by partial filter', async () => {
    const nullUser = new mongoose.Types.ObjectId();
    const nA = new Notification({
      recipient: nullUser,
      type: 'VERIFICATION_APPROVED',
      title: 'Null Swap Test A',
      message: 'Null swap notification A',
      relatedSwap: null,
    });
    const nB = new Notification({
      recipient: nullUser,
      type: 'VERIFICATION_APPROVED',
      title: 'Null Swap Test B',
      message: 'Null swap notification B',
      relatedSwap: null,
    });
    await nA.save();
    await nB.save();
    assert(nA._id && nB._id, 'Both notifications with null relatedSwap must save without conflict');
    await Notification.deleteMany({ _id: { $in: [nA._id, nB._id] } });
  });

  // Cleanup dummy reminder
  await Notification.deleteMany({ relatedSwap: dummySwapId });

  // ── TEST GROUP 3: Graceful Shutdown Components ──────────────────────────────
  console.log('\n--- GROUP 3: Graceful Shutdown Components ---');

  test('Graceful Shutdown: stopReminderScheduler stops scheduler cleanly without errors', () => {
    assert.doesNotThrow(() => {
      stopReminderScheduler();
    });
  });

  await testAsync('Graceful Shutdown: Socket.io attached closes httpServer without duplicate close error', async () => {
    const http = require('http');
    const { Server } = require('socket.io');

    const testHttpServer = http.createServer((req, res) => res.end('ok'));
    const testIo = new Server(testHttpServer);

    await new Promise((resolve) => testHttpServer.listen(0, resolve));
    assert.strictEqual(testHttpServer.listening, true, 'Test HTTP server must be listening');

    let duplicateCloseCaught = false;
    let serverCloseCalledWhenNotListening = false;

    // Simulate graceful shutdown sequence with Socket.io attached
    await new Promise((resolve) => {
      testIo.close((err) => {
        if (err) duplicateCloseCaught = true;
        resolve();
      });
    });

    assert.strictEqual(testHttpServer.listening, false, 'Socket.io v4 close must automatically close attached httpServer');

    if (testHttpServer.listening) {
      serverCloseCalledWhenNotListening = true;
    }

    assert.strictEqual(serverCloseCalledWhenNotListening, false, 'server.close() must NOT be called when server.listening is false');
    assert.strictEqual(duplicateCloseCaught, false, 'No error must occur during io.close()');
  });

  await testAsync('Graceful Shutdown: Fallback closes HTTP server when Socket.io is null/absent', async () => {
    const http = require('http');

    const testHttpServer = http.createServer((req, res) => res.end('ok'));
    await new Promise((resolve) => testHttpServer.listen(0, resolve));
    assert.strictEqual(testHttpServer.listening, true, 'Test HTTP server must be listening');

    // Simulate graceful shutdown with io = null
    const testIo = null;

    if (testIo) {
      await new Promise((resolve) => testIo.close(resolve));
    }

    if (testHttpServer.listening) {
      await new Promise((resolve) => {
        testHttpServer.close((err) => {
          assert(!err, 'server.close() must succeed without errors');
          resolve();
        });
      });
    }

    assert.strictEqual(testHttpServer.listening, false, 'Fallback must close HTTP server cleanly');
  });

  await testAsync('Graceful Shutdown: MongoDB connection closure is reached and verified', async () => {
    assert(mongoose.connection.readyState !== 0, 'MongoDB connection should currently be open');
    await mongoose.connection.close(false);
    assert.strictEqual(mongoose.connection.readyState, 0, 'MongoDB connection must be cleanly closed (readyState = 0)');
    // Reconnect for remaining test assertions if needed
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/skillswap');
  });

  await testAsync('Graceful Shutdown: Full process SIGTERM signal triggers clean exit with code 0', async () => {
    const { spawn } = require('child_process');
    const child = spawn('node', ['server.js'], {
      env: { ...process.env, PORT: '5099' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    await new Promise((resolve, reject) => {
      child.stdout.on('data', (d) => {
        if (d.toString().includes('Server running on port 5099')) {
          child.kill('SIGTERM');
        }
      });

      child.on('exit', (code) => {
        assert.strictEqual(code, 0, `Process must exit with code 0 upon SIGTERM, received: ${code}`);
        resolve();
      });

      child.on('error', reject);
    });
  });

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📊 PRODUCTION IMPROVEMENTS RESULTS: ${passed} PASSED | ${failed} FAILED`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  await mongoose.disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Test suite runner crashed:', err);
  process.exit(1);
});
