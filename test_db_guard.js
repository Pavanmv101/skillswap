/**
 * test_db_guard.js
 * Centralized Test Database Safety Guard & Isolation Helper for SkillSwap.
 *
 * Ensures:
 * 1. Tests execute EXCLUSIVELY against an approved test database (e.g. 'skillswap_test').
 * 2. Destructive cleanup is REFUSED if connected to 'skillswap' or any non-test database.
 * 3. Never falls back silently to production MONGO_URI.
 * 4. Never exposes credentials, passwords, or connection secrets in logs/errors.
 * 5. Automates clean test environment setup, isolated fixture cleanup, and graceful teardown.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Load .env first
dotenv.config();

// Optionally overlay local-only test configuration (.env.test.local) if present
const localTestEnvPath = path.join(__dirname, '.env.test.local');
if (fs.existsSync(localTestEnvPath)) {
  dotenv.config({ path: localTestEnvPath, override: true });
}

// Preserve original user-configured TEST_MONGO_URI before any defaults are applied
const CONFIGURED_TEST_MONGO_URI = process.env.TEST_MONGO_URI || null;

const mongoose = require('mongoose');

const APPROVED_TEST_DBS = new Set(['skillswap_test', 'skillswap_phase7_test']);
const ATLAS_TEST_DB = 'skillswap_phase7_test';

/**
 * Extracts and returns the database name from a MongoDB URI without exposing credentials.
 */
function extractDbName(uri) {
  if (!uri || typeof uri !== 'string') return '';
  try {
    const cleanUri = uri.trim();
    const qIndex = cleanUri.indexOf('?');
    const pathPart = qIndex !== -1 ? cleanUri.slice(0, qIndex) : cleanUri;
    const slashIndex = pathPart.lastIndexOf('/');
    if (slashIndex !== -1 && slashIndex < pathPart.length - 1) {
      return pathPart.slice(slashIndex + 1);
    }
    return '';
  } catch (_) {
    return '';
  }
}

/**
 * Computes and validates the approved test database URI.
 * Throws immediately if pointing to the production 'skillswap' database or unapproved name.
 * When requireAtlas: true is passed, strictly enforces TEST_MONGO_URI pointing to 'skillswap_phase7_test'.
 */
function getApprovedTestDbUri(options = {}) {
  const requireAtlas = options.requireAtlas === true;
  let uri = process.env.TEST_MONGO_URI;

  if (requireAtlas) {
    if (!uri) {
      throw new Error(
        "[TEST GUARD ERROR] TEST_MONGO_URI is missing. An explicit connection string targeting 'skillswap_phase7_test' is required for Atlas replica-set verification. Silent fallback to localhost or production is strictly forbidden."
      );
    }

    const dbName = extractDbName(uri);
    if (dbName !== ATLAS_TEST_DB) {
      throw new Error(
        `[TEST GUARD ERROR] Invalid database for Atlas test: '${dbName || 'unknown'}'. Atlas replica-set tests strictly require database name '${ATLAS_TEST_DB}'. Access to '${dbName}' is strictly forbidden.`
      );
    }

    return uri;
  }

  // Standard test execution (local test runner or general tests)
  // Defaults to local skillswap_test for fast, deterministic, zero-latency execution
  return 'mongodb://localhost:27017/skillswap_test';
}

/**
 * Prepares the test environment variables.
 * Must be called BEFORE loading server.js, config/db, or models so they bind to the test database.
 */
function initTestEnvironment(options = {}) {
  process.env.NODE_ENV = 'test';
  const testUri = getApprovedTestDbUri(options);
  process.env.MONGO_URI = testUri;
  process.env.MONGODB_URI = testUri;
  if (!process.env.TEST_MONGO_URI) {
    process.env.TEST_MONGO_URI = testUri;
  }
  return testUri;
}

/**
 * Asserts that the active Mongoose connection is targeting an approved test database.
 * Throws an error immediately if connected to production or any non-test database.
 */
function assertTestDatabaseSafe(mongooseInstance = mongoose) {
  if (!mongooseInstance.connection || mongooseInstance.connection.readyState === 0) {
    throw new Error('[TEST GUARD ERROR] No active MongoDB connection to verify.');
  }

  const db = mongooseInstance.connection.db;
  if (!db) {
    throw new Error('[TEST GUARD ERROR] MongoDB connection has not initialized a db object.');
  }

  const activeDbName = db.databaseName;
  if (activeDbName === 'skillswap' || !APPROVED_TEST_DBS.has(activeDbName)) {
    throw new Error(
      `[CRITICAL TEST SAFETY VIOLATION] Refusing destructive cleanup: '${activeDbName}' is NOT an approved test database! Production database is protected. Tests may only connect to: ${Array.from(APPROVED_TEST_DBS).join(', ')}.`
    );
  }

  return true;
}

/**
 * Asserts that the active Mongoose connection is targeting the exact isolated Atlas database.
 */
function assertAtlasTestDatabaseSafe(mongooseInstance = mongoose) {
  assertTestDatabaseSafe(mongooseInstance);

  const activeDbName = mongooseInstance.connection.db.databaseName;
  if (activeDbName !== ATLAS_TEST_DB) {
    throw new Error(
      `[CRITICAL TEST SAFETY VIOLATION] Refusing Atlas test execution: active database is '${activeDbName}', but Atlas tests require the exact isolated test database '${ATLAS_TEST_DB}'.`
    );
  }

  return true;
}

/**
 * Validates whether an isolated Atlas test connection is configured without exposing secrets.
 */
function validateAtlasConnectionConfig() {
  const uri = (process.env.TEST_MONGO_URI === 'mongodb://localhost:27017/skillswap_test' && !CONFIGURED_TEST_MONGO_URI)
    ? null
    : (process.env.TEST_MONGO_URI || CONFIGURED_TEST_MONGO_URI);

  if (!uri) {
    return {
      configured: false,
      reason: 'TEST_MONGO_URI is not set in environment or .env.test.local',
    };
  }

  const dbName = extractDbName(uri);
  const isAtlas = uri.startsWith('mongodb+srv://') || uri.includes('mongodb.net');

  if (dbName !== ATLAS_TEST_DB) {
    return {
      configured: false,
      reason: `TEST_MONGO_URI targets database '${dbName}', but must target '${ATLAS_TEST_DB}'`,
      databaseName: dbName,
    };
  }

  return {
    configured: true,
    isAtlas,
    databaseName: dbName,
    protocol: uri.split('://')[0],
  };
}

/**
 * Synchronizes schema indexes for core models in skillswap_test to guarantee
 * unique constraints (e.g. outboxEvent uniqueness) and sparse lookups are active.
 */
async function ensureTestIndexes() {
  try {
    const Notification = require('./models/Notification');
    const OutboxEvent = require('./models/OutboxEvent');
    const SwapRequest = require('./models/SwapRequest');
    const CircularExchange = require('./models/CircularExchange');
    const ExchangeReservation = require('./models/ExchangeReservation');
    const User = require('./models/User');

    await Promise.all([
      Notification.syncIndexes().catch(() => {}),
      OutboxEvent.syncIndexes().catch(() => {}),
      SwapRequest.syncIndexes().catch(() => {}),
      CircularExchange.syncIndexes().catch(() => {}),
      ExchangeReservation.syncIndexes().catch(() => {}),
      User.syncIndexes().catch(() => {}),
    ]);
  } catch (_) {}
}

/**
 * Connects Mongoose to the approved test database safely.
 */
async function connectTestDb(mongooseInstance = mongoose) {
  initTestEnvironment();
  const testUri = getApprovedTestDbUri();

  // If connection is in progress, wait for it to settle
  if (mongooseInstance.connection.readyState === 2) {
    try {
      await mongooseInstance.connection.asPromise();
    } catch (_) {}
  }

  // If connected to wrong DB, disconnect first and reconnect to testUri
  if (mongooseInstance.connection && mongooseInstance.connection.readyState === 1) {
    const currentName = mongooseInstance.connection.db?.databaseName;
    if (currentName && !currentName.endsWith('_test')) {
      await mongooseInstance.disconnect();
      await mongooseInstance.connect(testUri, { serverSelectionTimeoutMS: 5000 });
    }
  } else if (mongooseInstance.connection.readyState === 0) {
    await mongooseInstance.connect(testUri, { serverSelectionTimeoutMS: 5000 });
  }

  // Ensure fully connected
  if (mongooseInstance.connection.readyState !== 1) {
    await mongooseInstance.connection.asPromise();
  }

  assertTestDatabaseSafe(mongooseInstance);
  await ensureTestIndexes();
  return mongooseInstance.connection;
}

/**
 * Performs safe, isolated cleanup of test collections in skillswap_test.
 * Strictly verifies database safety before executing any delete operation.
 */
async function safeCleanCollections(modelList = [], mongooseInstance = mongoose) {
  assertTestDatabaseSafe(mongooseInstance);

  for (const model of modelList) {
    if (model && typeof model.deleteMany === 'function') {
      await model.deleteMany({});
    }
  }
}

/**
 * Disconnects test database connection cleanly.
 */
async function disconnectTestDb(mongooseInstance = mongoose) {
  if (mongooseInstance.connection && mongooseInstance.connection.readyState !== 0) {
    await mongooseInstance.disconnect();
  }
}

// Auto-initialize environment on require to protect all downstream imports
initTestEnvironment();

module.exports = {
  APPROVED_TEST_DBS,
  ATLAS_TEST_DB,
  getApprovedTestDbUri,
  initTestEnvironment,
  assertTestDatabaseSafe,
  assertAtlasTestDatabaseSafe,
  validateAtlasConnectionConfig,
  connectTestDb,
  safeCleanCollections,
  disconnectTestDb,
};
