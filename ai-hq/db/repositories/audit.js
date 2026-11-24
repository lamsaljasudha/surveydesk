// ai-hq/db/repositories/audit.js
// Uses ai_hq_write_audit_event(...) exactly as defined in schema.sql.

const { query } = require('../../../db');

async function writeAuditEvent({
  actorType,
  actorOwnerId = null,
  actorAgentId = null,
  actorWorkerId = null,
  actorIsSystem = false,
  eventType,
  entityType = null,
  entityId = null,
  taskId = null,
  attemptId = null,
  metadata = {},
  client = null, // optional: pass an existing tx client
}) {
  const runner = client ? (t, p) => client.query(t, p) : query;

  const result = await runner(
    `SELECT ai_hq_write_audit_event(
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
        ) AS event_id`,
    [
      actorType,
      actorOwnerId,
      actorAgentId,
      actorWorkerId,
      actorIsSystem,
      eventType,
      entityType,
      entityId,
      taskId,
      attemptId,
      JSON.stringify(metadata || {}),
    ]
  );
  return result.rows[0].event_id;
}

async function getAuditLogs({ limit = 50, eventType = null } = {}) {
  const params = [];
  const where = [];

  if (eventType) {
    params.push(eventType);
    where.push(`event_type = $${params.length}`);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  params.push(limit);

  const result = await query(
    `SELECT * FROM ai_audit_events ${clause}
     ORDER BY occurred_at DESC, sequence_no DESC
     LIMIT $${params.length}`,
    params
  );
  return result.rows;
}

async function verifyChain({
  actorType,
  actorOwnerId = null,
  actorAgentId = null,
  actorWorkerId = null,
}) {
  const actorKey = actorOwnerId || actorAgentId || actorWorkerId || 'system';
  const result = await query(
    `SELECT id, sequence_no, prev_hash, event_hash, event_type, occurred_at
     FROM ai_audit_events
     WHERE actor_type = $1
       AND COALESCE(actor_owner_id::text, actor_agent_id::text, actor_worker_id::text, 'system') = $2
     ORDER BY sequence_no ASC`,
    [actorType, actorKey]
  );

  let expectedPrevHash = null;
  for (const row of result.rows) {
    if (row.prev_hash !== expectedPrevHash) {
      return {
        broken: true,
        rowId: row.id,
        sequenceNo: row.sequence_no,
        expectedPrevHash,
        actualPrevHash: row.prev_hash,
      };
    }
    expectedPrevHash = row.event_hash;
  }
  return { broken: false, count: result.rowCount };
}

module.exports = { writeAuditEvent, getAuditLogs, verifyChain };
