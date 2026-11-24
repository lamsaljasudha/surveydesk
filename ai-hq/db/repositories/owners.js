// ai-hq/db/repositories/owners.js
// Owner identity repository. NO users table. NO email. NO password.

const { query, withTransaction } = require('../../../db');
const { writeAuditEvent } = require('./audit');

async function createOwner({
  externalUserId,
  displayName,
  grantedByOwnerId = null,
  actorOwnerId = null,
}) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `INSERT INTO ai_hq_owners (external_user_id, display_name, granted_by_owner_id)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [externalUserId, displayName, grantedByOwnerId]
    );
    const owner = result.rows[0];

    await writeAuditEvent({
      actorType: 'human',
      actorOwnerId: actorOwnerId || grantedByOwnerId,
      eventType: 'owner.created',
      entityType: 'ai_hq_owner',
      entityId: owner.id,
      metadata: { external_user_id: externalUserId, display_name: displayName },
      client,
    });

    return owner;
  });
}

async function revokeOwner({ ownerId, revokedByOwnerId, reason }) {
  return withTransaction(async (client) => {
    // Prevent removing the final active owner
    const countRes = await client.query(
      `SELECT COUNT(*)::integer AS n FROM ai_hq_owners WHERE is_active = TRUE FOR UPDATE`
    );
    if (countRes.rows[0].n <= 1) {
      throw new Error('Cannot revoke the final active owner.');
    }

    const result = await client.query(
      `UPDATE ai_hq_owners
       SET is_active = FALSE,
           revoked_at = NOW(),
           revoked_by_owner_id = $2,
           revoke_reason = $3,
           updated_at = NOW()
       WHERE id = $1 AND is_active = TRUE
       RETURNING *`,
      [ownerId, revokedByOwnerId, reason]
    );
    if (!result.rowCount) {
      throw new Error('Owner not found or already revoked.');
    }
    const owner = result.rows[0];

    await writeAuditEvent({
      actorType: 'human',
      actorOwnerId: revokedByOwnerId,
      eventType: 'owner.revoked',
      entityType: 'ai_hq_owner',
      entityId: ownerId,
      metadata: { reason },
      client,
    });

    return owner;
  });
}

async function isOwner(externalUserId) {
  const res = await query(
    `SELECT 1 FROM ai_hq_owners
     WHERE external_user_id = $1 AND is_active = TRUE LIMIT 1`,
    [externalUserId]
  );
  return res.rowCount > 0;
}

async function listOwners() {
  const res = await query(
    `SELECT id, external_user_id, display_name, role, granted_at
     FROM ai_hq_owners WHERE is_active = TRUE ORDER BY granted_at`
  );
  return res.rows;
}

async function getOwnerByExternalId(externalUserId) {
  const res = await query(
    `SELECT * FROM ai_hq_owners
     WHERE external_user_id = $1 AND is_active = TRUE LIMIT 1`,
    [externalUserId]
  );
  return res.rows[0] || null;
}

async function bootstrapFirstOwner({ externalUserId, displayName }) {
  return withTransaction(async (client) => {
    // Only allow bootstrap if zero active owners exist
    const countRes = await client.query(
      `SELECT COUNT(*)::integer AS n FROM ai_hq_owners WHERE is_active = TRUE FOR UPDATE`
    );
    if (countRes.rows[0].n > 0) {
      throw new Error('Bootstrap refused: an active owner already exists.');
    }

    const result = await client.query(
      `INSERT INTO ai_hq_owners (external_user_id, display_name, role)
       VALUES ($1, $2, 'owner')
       RETURNING *`,
      [externalUserId, displayName]
    );
    const owner = result.rows[0];

    await client.query(
      `UPDATE ai_settings
       SET value = 'true'::jsonb, updated_at = NOW()
       WHERE scope_type = 'global' AND key = 'ai_hq.bootstrap_completed'`
    );

    await writeAuditEvent({
      actorType: 'system',
      actorIsSystem: true,
      eventType: 'owner.bootstrap',
      entityType: 'ai_hq_owner',
      entityId: owner.id,
      metadata: { external_user_id: externalUserId },
      client,
    });

    return owner;
  });
}

module.exports = {
  createOwner,
  revokeOwner,
  isOwner,
  listOwners,
  getOwnerByExternalId,
  bootstrapFirstOwner,
};
