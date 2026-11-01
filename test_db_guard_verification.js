/**
 * test_db_guard_verification.js
 * Verification suite for test database safety guard and cleanup isolation.
 */

'use strict';

const assert = require('assert');
const mongoose = require('mongoose');
const {
  APPROVED_TEST_DBS,
  getApprovedTestDbUri,
  initTestEnvironment,
  assertTestDatabaseSafe,
  connectTestDb,
  disconnectTestDb,
  safeCleanCollections,
} = require('./test_db_guard');

async function runGuardTests() {
  console.log('================================================================');
  console.log('🧪 TEST DATABASE SAFETY GUARD & ISOLATION VERIFICATION');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function pass(desc) {
    console.log(`  ✅ ${desc}`);
    passed++;
  }

  function fail(desc, err) {
    console.error(`  ❌ ${desc}`);
    console.error(`     Error: ${err.message}`);
    failed++;
  }

  // 1. Environment initialization
  try {
    const testUri = initTestEnvironment();
    assert.strictEqual(process.env.NODE_ENV, 'test');
    assert(process.env.MONGO_URI.includes('skillswap_test'));
    assert(process.env.MONGODB_URI.includes('skillswap_test'));
    pass('1. initTestEnvironment sets NODE_ENV=test and overrides MONGO_URI to skillswap_test');
  } catch (err) {
    fail('1. initTestEnvironment', err);
  }

  // 2. Approved test URI validation
  try {
    const uri = getApprovedTestDbUri();
    assert(uri.includes('skillswap_test'));
    assert(!uri.includes('password')); // No plaintext credential leak
    pass('2. getApprovedTestDbUri generates valid skillswap_test URI without leaking secrets');
  } catch (err) {
    fail('2. getApprovedTestDbUri', err);
  }

  // 3. Connects exclusively to test database
  try {
    await connectTestDb();
    const activeDbName = mongoose.connection.db.databaseName;
    assert(APPROVED_TEST_DBS.has(activeDbName));
    assert(assertTestDatabaseSafe());
    pass(`3. connectTestDb connects Mongoose exclusively to approved test database (${activeDbName})`);
  } catch (err) {
    fail('3. connectTestDb', err);
  }

  // 4. Critical safety guard blocks production database
  try {
    const mockProdConn = {
      connection: {
        readyState: 1,
        db: { databaseName: 'skillswap' }
      }
    };
    let errorCaught = false;
    try {
      assertTestDatabaseSafe(mockProdConn);
    } catch (guardErr) {
      errorCaught = true;
      assert(guardErr.message.includes('NOT an approved test database') || guardErr.message.includes('NOT a test database'));
      assert(guardErr.message.includes('Refusing destructive cleanup'));
    }
    assert(errorCaught, 'Guard must throw when presented with production database name');
    pass('4. assertTestDatabaseSafe strictly refuses destructive cleanup if connected to production');
  } catch (err) {
    fail('4. assertTestDatabaseSafe production check', err);
  }

  // 5. Clean teardown and disconnection
  try {
    await disconnectTestDb();
    assert.strictEqual(mongoose.connection.readyState, 0);
    pass('5. disconnectTestDb cleanly terminates connection');
  } catch (err) {
    fail('5. disconnectTestDb', err);
  }

  // 6. Rejection of unexpected / unauthorized database names
  try {
    const mockInvalidConn = {
      connection: {
        readyState: 1,
        db: { databaseName: 'unauthorized_db' }
      }
    };
    let errorCaught = false;
    try {
      assertTestDatabaseSafe(mockInvalidConn);
    } catch (err) {
      errorCaught = true;
      assert(err.message.includes('NOT an approved test database'));
    }
    assert(errorCaught, 'Must reject unexpected database names');
    pass('6. assertTestDatabaseSafe rejects arbitrary unauthorized database names');
  } catch (err) {
    fail('6. reject unexpected database names', err);
  }

  // 7. Rejection of missing TEST_MONGO_URI when Atlas verification is required
  try {
    const originalUri = process.env.TEST_MONGO_URI;
    delete process.env.TEST_MONGO_URI;

    let errorCaught = false;
    try {
      getApprovedTestDbUri({ requireAtlas: true });
    } catch (err) {
      errorCaught = true;
      assert(err.message.includes('TEST_MONGO_URI is missing'));
      assert(err.message.includes('Silent fallback to localhost or production is strictly forbidden'));
    }

    if (originalUri) process.env.TEST_MONGO_URI = originalUri;
    assert(errorCaught, 'Must throw when TEST_MONGO_URI is missing in Atlas test mode');
    pass('7. getApprovedTestDbUri({ requireAtlas: true }) rejects missing TEST_MONGO_URI without silent fallback');
  } catch (err) {
    fail('7. reject missing TEST_MONGO_URI in Atlas mode', err);
  }

  // 8. Rejection if TEST_MONGO_URI targets unapproved database in Atlas mode
  try {
    const originalUri = process.env.TEST_MONGO_URI;
    process.env.TEST_MONGO_URI = 'mongodb+srv://user:pass@cluster.mongodb.net/skillswap?retryWrites=true';

    let errorCaught = false;
    try {
      getApprovedTestDbUri({ requireAtlas: true });
    } catch (err) {
      errorCaught = true;
      assert(err.message.includes("Atlas replica-set tests strictly require database name 'skillswap_phase7_test'"));
    }

    if (originalUri) {
      process.env.TEST_MONGO_URI = originalUri;
    } else {
      delete process.env.TEST_MONGO_URI;
    }

    assert(errorCaught, 'Must throw if TEST_MONGO_URI targets production in Atlas mode');
    pass('8. getApprovedTestDbUri({ requireAtlas: true }) strictly rejects production database');
  } catch (err) {
    fail('8. reject production database in Atlas mode', err);
  }

  // 9. Acceptance of exact 'skillswap_phase7_test' database in Atlas mode
  try {
    const originalUri = process.env.TEST_MONGO_URI;
    process.env.TEST_MONGO_URI = 'mongodb+srv://user:pass@cluster.mongodb.net/skillswap_phase7_test?retryWrites=true';

    const validUri = getApprovedTestDbUri({ requireAtlas: true });
    assert(validUri.includes('skillswap_phase7_test'));

    const mockAtlasConn = {
      connection: {
        readyState: 1,
        db: { databaseName: 'skillswap_phase7_test' }
      }
    };
    assert(assertTestDatabaseSafe(mockAtlasConn));

    if (originalUri) {
      process.env.TEST_MONGO_URI = originalUri;
    } else {
      delete process.env.TEST_MONGO_URI;
    }

    pass('9. Guard validates and accepts exact isolated database skillswap_phase7_test');
  } catch (err) {
    fail('9. accept skillswap_phase7_test', err);
  }

  console.log('\n================================================================');
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  console.log('================================================================\n');

  if (failed > 0) process.exit(1);
}

runGuardTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
