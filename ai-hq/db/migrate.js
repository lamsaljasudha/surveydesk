// ai-hq/db/migrate.js
// Safe migration runner. Refuses to touch surveypro_db.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const FORBIDDEN_DB_NAMES = ['surveypro_db', 'surveypro'];
const REQUIRED_ENV = 'AI_HQ_DATABASE_URL';

function extractDatabaseName(connectionString) {
  try {
    const url = new URL(connectionString);
    return url.pathname.replace(/^\//, '');
  } catch {
    return null;
  }
}

function assertSafeDatabase(connectionString) {
  const dbName = extractDatabaseName(connectionString);
  if (!dbName) {
    throw new Error('Cannot parse database name from AI_HQ_DATABASE_URL.');
  }
  if (FORBIDDEN_DB_NAMES.includes(dbName.toLowerCase())) {
    throw new Error(
      `REFUSING to run against "${dbName}". AI HQ must use a dedicated database. ` +
        `Set AI_HQ_DATABASE_URL to a separate database (e.g., "ai_hq_db").`
    );
  }
  console.log(`[AI-HQ] Target database: ${dbName}`);
  return dbName;
}

async function detectIncompatibleSchema(client) {
  // Look for an old-style users table that would signal a stale schema
  const res = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'users'
  `);
  if (res.rowCount === 0) return null;

  const cols = await client.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users'
  `);
  const names = cols.rows.map((r) => r.column_name);
  if (!names.includes('email')) {
    return {
      problem: 'A "users" table exists in the target database without an "email" column.',
      fix:
        'This is a leftover from an earlier partial migration. ' +
        'Drop it manually (DROP TABLE users CASCADE) or migrate to a fresh database.',
    };
  }
  return null;
}

async function migrate() {
  const connectionString = process.env[REQUIRED_ENV];
  if (!connectionString) {
    throw new Error(`Missing required environment variable: ${REQUIRED_ENV}`);
  }
  assertSafeDatabase(connectionString);

  const schemaPath = path.join(__dirname, 'schema.sql');
  if (!fs.existsSync(schemaPath)) {
    throw new Error(`Schema file not found: ${schemaPath}`);
  }
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');

  const client = new Client({ connectionString });
  await client.connect();

  try {
    console.log('[AI-HQ] Starting database migration...');

    const incompatible = await detectIncompatibleSchema(client);
    if (incompatible) {
      console.error('[AI-HQ] Detected incompatible pre-existing schema:');
      console.error(`  Problem: ${incompatible.problem}`);
      console.error(`  Fix:     ${incompatible.fix}`);
      throw new Error('Migration aborted to avoid damaging existing data.');
    }

    await client.query(schemaSql);
    console.log('[AI-HQ] Migration completed successfully.');
  } catch (err) {
    console.error('[AI-HQ] Migration failed:', err.message);
    if (err.code === '42703') {
      console.error(
        '[AI-HQ] HINT: Column does not exist. A query in a repository file ' +
          'references a column not in schema.sql.'
      );
    }
    throw err;
  } finally {
    await client.end();
  }
}

async function rollback() {
  console.log('[AI-HQ] ROLLBACK is disabled by default to prevent data loss.');
  console.log('[AI-HQ] If you really need to drop tables, do it manually.');
  throw new Error('Rollback disabled.');
}

const cmd = process.argv[2];
if (require.main === module) {
  if (cmd === 'up') {
    migrate()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  } else if (cmd === 'down') {
    rollback()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  } else {
    console.log('Usage: node ai-hq/db/migrate.js [up|down]');
    process.exit(1);
  }
}

module.exports = { migrate, rollback };
