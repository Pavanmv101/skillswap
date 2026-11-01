/**
 * run_tests.js
 * Unified Test Runner for SkillSwap
 *
 * Provides grouped and complete test suite execution with strict database isolation
 * and safety guard enforcement.
 *
 * Usage:
 *   node run_tests.js [target]
 *
 * Targets:
 *   security  - Runs HTTP rate limiting, input validation, and WebRTC authorization
 *   webrtc    - Runs WebRTC room authorization and roomId index lookup tests
 *   outbox    - Runs transactional outbox dispatcher, concurrency, and lease management
 *   circular  - Runs circular cycle detection, reservations, scheduling, and completion
 *   phase7    - Runs Phase 7.1 security, Phase 7.2.1 index, and Phase 7.2.2 db guard
 *   all       - Runs all 10 verified test suites in deterministic sequence (default)
 */

'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const { getApprovedTestDbUri, initTestEnvironment } = require('./test_db_guard');

// Initialize test environment variables
const testDbUri = initTestEnvironment();

const SUITE_GROUPS = {
  security: [
    'test_phase7_security_remediation.js',
    'test_phase6_webrtc_room_authorization.js',
  ],
  webrtc: [
    'test_phase6_webrtc_room_authorization.js',
    'test_phase7_room_index_verification.js',
  ],
  outbox: [
    'test_phase6_outbox_dispatcher.js',
  ],
  circular: [
    'test_phase6_audit_remediation.js',
    'test_phase6_stage3_part1_verification.js',
    'test_phase6_stage4_completion_verification.js',
    'test_phase6_stage5_notification_verification.js',
  ],
  phase7: [
    'test_db_guard_verification.js',
    'test_phase7_security_remediation.js',
    'test_phase7_room_index_verification.js',
  ],
  all: [
    'test_db_guard_verification.js',
    'test_phase7_security_remediation.js',
    'test_phase6_webrtc_room_authorization.js',
    'test_phase7_room_index_verification.js',
    'test_phase6_outbox_dispatcher.js',
    'test_phase6_audit_remediation.js',
    'test_phase6_stage3_part1_verification.js',
    'test_phase6_stage4_completion_verification.js',
    'test_phase6_stage5_notification_verification.js',
    'test_production_improvements.js',
  ],
};

const target = (process.argv[2] || 'all').toLowerCase();
const suitesToRun = SUITE_GROUPS[target] || (
  target.endsWith('.js') ? [target] : null
);

if (!suitesToRun) {
  console.error(`\n❌ Unknown test target: "${target}"`);
  console.error(`Available targets: ${Object.keys(SUITE_GROUPS).join(', ')} or a specific test file\n`);
  process.exit(1);
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`🧪 SKILLSWAP UNIFIED TEST RUNNER — TARGET: [${target.toUpperCase()}]`);
console.log(`🔒 Active Test Database: skillswap_test (Production Protected)`);
console.log(`📋 Suites to execute: ${suitesToRun.length}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

const startTime = Date.now();
const results = [];
let overallFailed = false;

for (let i = 0; i < suitesToRun.length; i++) {
  const suiteFile = suitesToRun[i];
  const suiteNum = `[${i + 1}/${suitesToRun.length}]`;
  process.stdout.write(`⏳ ${suiteNum} Running ${suiteFile}... `);

  const suiteStart = Date.now();
  const proc = spawnSync('node', [path.join(__dirname, suiteFile)], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      MONGO_URI: testDbUri,
      MONGODB_URI: testDbUri,
      TEST_MONGO_URI: testDbUri,
    },
    stdio: 'pipe',
  });
  const duration = ((Date.now() - suiteStart) / 1000).toFixed(2);

  if (proc.status === 0) {
    console.log(`PASSED ✅ (${duration}s)`);
    results.push({ file: suiteFile, status: 'PASSED', duration });
  } else {
    console.log(`FAILED ❌ (${duration}s)`);
    results.push({ file: suiteFile, status: 'FAILED', duration });
    overallFailed = true;

    console.error('\n' + '─'.repeat(70));
    console.error(`💥 FAILURE DETAILS FOR ${suiteFile}:`);
    console.error('─'.repeat(70));
    if (proc.stdout && proc.stdout.length > 0) {
      console.error(proc.stdout.toString());
    }
    if (proc.stderr && proc.stderr.length > 0) {
      console.error(proc.stderr.toString());
    }
    console.error('─'.repeat(70) + '\n');
    break; // Fail-fast on error
  }
}

const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('📊 EXECUTION SUMMARY');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
results.forEach(r => {
  const icon = r.status === 'PASSED' ? '✅' : '❌';
  console.log(`  ${icon} ${r.file.padEnd(46)} ${r.status} (${r.duration}s)`);
});
console.log('─'.repeat(70));
console.log(`Total Duration: ${totalDuration}s`);

if (overallFailed) {
  console.log('\n❌ TEST RUN FAILED. Inspect error log above.\n');
  process.exit(1);
} else {
  console.log('\n🎉 ALL EXECUTED SUITES PASSED CLEANLY WITH ZERO ERRORS!\n');
  process.exit(0);
}
