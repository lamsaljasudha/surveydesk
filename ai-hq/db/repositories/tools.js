// ai-hq/db/repositories/tools.js
// Tool execution records support idempotency and uncertain-outcome handling.

const crypto = require('crypto');
const { query, withTransaction } = require('../../../db');
const { writeAuditEvent } = require('./audit');

function canonicalHash(params) {
  // Deterministic JSON serialization for stable hashing
  const canonical = JSON.stringify(params, Object.keys(params).sort());
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

async function reserveToolExecution({
  idempotencyKey,
  agentId,
  taskId,
  attemptId,
  toolKey,
  toolVersion = '1.0',
  paramsCanonical,
  sideEffectClass,
}) {
  const paramsHash = canonicalHash(paramsCanonical);

  return withTransaction(async (client) => {
    // Try to find existing reservation for idempotency
    const existing = await client.query(
      `SELECT * FROM ai_tool_executions WHERE idempotency_key = $1`,
      [idempotencyKey]
    );
    if (existing.rowCount) {
      return { execution: existing.rows[0], reused: true };
    }

    const res = await client.query(
      `INSERT INTO ai_tool_executions (
          idempotency_key, task_id, attempt_id, agent_id,
          tool_key, tool_version, params_canonical, params_hash,
          side_effect_class, state
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'reserved')
       RETURNING *`,
      [
        idempotencyKey,
        taskId,
        attemptId,
        agentId,
        toolKey,
        toolVersion,
        paramsCanonical,
        paramsHash,
        sideEffectClass,
      ]
    );

    await writeAuditEvent({
      actorType: 'agent',
      actorAgentId: agentId,
      eventType: 'tool.reserved',
      entityType: 'ai_tool_execution',
      entityId: res.rows[0].id,
      taskId,
      attemptId,
      metadata: { tool_key: toolKey, side_effect_class: sideEffectClass },
      client,
    });

    return { execution: res.rows[0], reused: false };
  });
}

async function markInFlight({ executionId }) {
  const res = await query(
    `UPDATE ai_tool_executions SET state = 'in_flight' WHERE id = $1 AND state = 'reserved' RETURNING *`,
    [executionId]
  );
  return res.rows[0] || null;
}

async function markSucceeded({ executionId, result, providerReference = null }) {
  const res = await query(
    `UPDATE ai_tool_executions
     SET state = 'succeeded', result = $2, provider_reference = $3, finished_at = NOW()
     WHERE id = $1 AND state IN ('reserved','in_flight')
     RETURNING *`,
    [executionId, result, providerReference]
  );
  return res.rows[0] || null;
}

async function markFailed({ executionId, errorDetail }) {
  const res = await query(
    `UPDATE ai_tool_executions
     SET state = 'failed', error_detail = $2, finished_at = NOW()
     WHERE id = $1 AND state IN ('reserved','in_flight')
     RETURNING *`,
    [executionId, errorDetail]
  );
  return res.rows[0] || null;
}

async function markUnknown({ executionId, errorDetail }) {
  // Use when provider outcome is uncertain — never refunds budget
  const res = await query(
    `UPDATE ai_tool_executions
     SET state = 'unknown', error_detail = $2, finished_at = NOW()
     WHERE id = $1 AND state IN ('reserved','in_flight')
     RETURNING *`,
    [executionId, errorDetail]
  );
  return res.rows[0] || null;
}

async function listStaleInFlight(olderThanMinutes = 30) {
  const res = await query(
    `SELECT * FROM ai_tool_executions
     WHERE state IN ('in_flight','unknown')
       AND started_at < NOW() - ($1 || ' minutes')::interval`,
    [String(olderThanMinutes)]
  );
  return res.rows;
}

module.exports = {
  reserveToolExecution,
  markInFlight,
  markSucceeded,
  markFailed,
  markUnknown,
  listStaleInFlight,
  canonicalHash,
};
