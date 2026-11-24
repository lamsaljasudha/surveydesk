// ai-hq/db/repositories/tasks.js
// Task creation with delegation depth enforcement, lease acquisition, retries.

const { query, withTransaction } = require('../../../db');
const { writeAuditEvent } = require('./audit');

async function createTask({
  agentId,
  title,
  objective,
  priority = 'normal',
  payload = {},
  parentTaskId = null,
  idempotencyKey = null,
  maxAttempts = 3,
  createdByOwnerId = null,
  deadlineAt = null,
}) {
  return withTransaction(async (client) => {
    let delegationDepth = 0;
    let parentAgentId = null;

    if (parentTaskId) {
      const parent = await client.query(
        `SELECT t.agent_id, t.delegation_depth, a.max_delegation_depth
         FROM ai_tasks t JOIN ai_agents a ON a.id = t.agent_id
         WHERE t.id = $1`,
        [parentTaskId]
      );
      if (!parent.rowCount) throw new Error('Parent task not found');
      delegationDepth = parent.rows[0].delegation_depth + 1;
      parentAgentId = parent.rows[0].agent_id;
      if (delegationDepth > parent.rows[0].max_delegation_depth) {
        throw new Error(`Delegation depth ${delegationDepth} exceeds max`);
      }
    }

    const res = await client.query(
      `INSERT INTO ai_tasks (
          agent_id, parent_task_id, delegation_depth, title, objective,
          priority, payload, idempotency_key, max_attempts, deadline_at,
          created_by_owner_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        agentId,
        parentTaskId,
        delegationDepth,
        title,
        objective,
        priority,
        payload,
        idempotencyKey,
        maxAttempts,
        deadlineAt,
        createdByOwnerId,
      ]
    );
    const task = res.rows[0];

    await writeAuditEvent({
      actorType: parentAgentId ? 'agent' : createdByOwnerId ? 'human' : 'system',
      actorOwnerId: parentAgentId ? null : createdByOwnerId,
      actorAgentId: parentAgentId,
      actorIsSystem: !parentAgentId && !createdByOwnerId,
      eventType: 'task.created',
      entityType: 'ai_task',
      entityId: task.id,
      taskId: task.id,
      metadata: { agent_id: agentId, priority, delegation_depth: delegationDepth },
      client,
    });

    return task;
  });
}

async function claimNextTask({ workerId, leaseSeconds = 300 }) {
  return withTransaction(async (client) => {
    // Claim a pending task atomically using SKIP LOCKED
    const res = await client.query(
      `WITH candidate AS (
         SELECT t.id
         FROM ai_tasks t
         WHERE t.status = 'pending'
           AND (t.next_retry_at IS NULL OR t.next_retry_at <= NOW())
         ORDER BY
           CASE t.priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
           t.created_at
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
       UPDATE ai_tasks t
       SET status = 'running',
           lease_owner_worker_id = $1,
           lease_epoch = t.lease_epoch + 1,
           lease_expires_at = NOW() + ($2 || ' seconds')::interval,
           heartbeat_at = NOW(),
           attempts = t.attempts + 1,
           updated_at = NOW()
       FROM candidate
       WHERE t.id = candidate.id
       RETURNING t.*`,
      [workerId, String(leaseSeconds)]
    );
    if (!res.rowCount) return null;
    const task = res.rows[0];

    const attemptRes = await client.query(
      `INSERT INTO ai_task_attempts (task_id, attempt_no, worker_id, lease_epoch)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [task.id, task.attempts, workerId, task.lease_epoch]
    );

    return { task, attempt: attemptRes.rows[0] };
  });
}

async function heartbeatTask({ taskId, workerId, leaseEpoch, extendSeconds = 300 }) {
  const res = await query(
    `UPDATE ai_tasks
     SET heartbeat_at = NOW(),
         lease_expires_at = NOW() + ($3 || ' seconds')::interval,
         updated_at = NOW()
     WHERE id = $1
       AND lease_owner_worker_id = $2
       AND lease_epoch = $4
       AND status = 'running'
     RETURNING id`,
    [taskId, workerId, String(extendSeconds), leaseEpoch]
  );
  return res.rowCount > 0;
}

async function completeTask({ taskId, workerId, leaseEpoch, result, tokensUsed = 0, costUsd = 0 }) {
  return withTransaction(async (client) => {
    const res = await client.query(
      `UPDATE ai_tasks
       SET status = 'completed',
           result = $3,
           tokens_used = tokens_used + $4,
           cost_usd = cost_usd + $5,
           completed_at = NOW(),
           updated_at = NOW()
       WHERE id = $1
         AND lease_owner_worker_id = $2
         AND lease_epoch = $6
         AND status = 'running'
       RETURNING *`,
      [taskId, workerId, result, tokensUsed, costUsd, leaseEpoch]
    );
    if (!res.rowCount) throw new Error('Task not claimed by this worker/epoch');

    await client.query(
      `UPDATE ai_task_attempts
       SET status = 'succeeded', ended_at = NOW(),
           tokens_used = $3, cost_usd = $4
       WHERE task_id = $1 AND lease_epoch = $2 AND status = 'running'`,
      [taskId, leaseEpoch, tokensUsed, costUsd]
    );

    return res.rows[0];
  });
}

async function failTask({ taskId, workerId, leaseEpoch, errorClass, errorDetail }) {
  return withTransaction(async (client) => {
    const res = await client.query(
      `UPDATE ai_tasks
       SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
           next_retry_at = CASE WHEN attempts >= max_attempts THEN NULL
                                ELSE NOW() + (LEAST(60, attempts * 10) || ' seconds')::interval END,
           error_summary = $4,
           lease_owner_worker_id = NULL,
           lease_expires_at = NULL,
           updated_at = NOW()
       WHERE id = $1
         AND lease_owner_worker_id = $2
         AND lease_epoch = $3
         AND status = 'running'
       RETURNING *`,
      [taskId, workerId, leaseEpoch, errorDetail]
    );

    await client.query(
      `UPDATE ai_task_attempts
       SET status = 'failed', ended_at = NOW(),
           error_class = $3, error_detail = $4
       WHERE task_id = $1 AND lease_epoch = $2 AND status = 'running'`,
      [taskId, leaseEpoch, errorClass, errorDetail]
    );

    return res.rows[0] || null;
  });
}

async function reclaimExpiredLeases() {
  const res = await query(
    `UPDATE ai_tasks
     SET status = 'pending',
         lease_owner_worker_id = NULL,
         lease_expires_at = NULL,
         updated_at = NOW()
     WHERE status = 'running'
       AND lease_expires_at < NOW()
     RETURNING id`
  );
  return res.rowCount;
}

module.exports = {
  createTask,
  claimNextTask,
  heartbeatTask,
  completeTask,
  failTask,
  reclaimExpiredLeases,
};
