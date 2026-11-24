// ai-hq/db/bootstrap.js
// One-time initial owner bootstrap.
// Usage: node ai-hq/db/bootstrap.js <external-user-uuid> "<Display Name>"

require('dotenv').config();
const { bootstrapFirstOwner } = require('./repositories/owners');
const { closePool } = require('../../db');

async function main() {
  const externalUserId = process.argv[2];
  const displayName = process.argv[3];

  if (!externalUserId || !displayName) {
    console.error('Usage: node ai-hq/db/bootstrap.js <external-user-uuid> "<Display Name>"');
    process.exit(1);
  }

  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRe.test(externalUserId)) {
    console.error('Error: external-user-uuid must be a valid UUID');
    process.exit(1);
  }

  try {
    const owner = await bootstrapFirstOwner({ externalUserId, displayName });
    console.log('[AI-HQ] Bootstrap successful. Owner created:');
    console.log(JSON.stringify(owner, null, 2));
  } catch (err) {
    console.error('[AI-HQ] Bootstrap failed:', err.message);
    process.exit(1);
  } finally {
    await closePool();
  }
}

if (require.main === module) {
  main();
}
