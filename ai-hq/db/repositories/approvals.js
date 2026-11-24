// ai-hq/db/repositories/approvals.js
// Owners approve or reject high-risk actions. Agents cannot self-approve.

const { query, withTransaction } = require('../../../db');
const { writeAuditEvent } = require('./audit');

async function createApproval({
  agentId,
  taskId,
  toolExecutionId,
  toolKey,
  paramsCanonical,
  actionFingerprint,
  humanReadableSummary,
  riskLevel = 'medium',
  expiresInSeconds = 3600,
}) {
  return withTransaction(async (client) => {
    const res = await client.query(
      `INSERT INTO ai_approvals (
          agent_id, task_id, tool_execution_id, tool_key,
          params_canonical, action_fingerprint, human_readable_summary,
          risk_level, expires_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8, NOW() + ($9 || ' seconds')::interval)
       RETURNING *`,
      [
        agentId,
        taskId,
        toolExecutionId,
        toolKey,
        paramsCanonical,
        actionFingerprint,
        humanReadableSummary,
        riskLevel,
        String(expiresInSeconds),
      ]
    );

    await writeAuditEvent({
      actorType: 'agent',
      actorAgentId: agentId,
      eventType: 'approval.requested',
      entityType: 'ai_approval',
      entityId: res.rows[0].id,
      taskId,
      metadata: { tool_key: toolKey, risk_level: riskLevel },
      client,
    });

    return res.rows[0];
  });
}

async function decideApproval({ approvalId, decidedByOwnerId, decision, decisionNote = null }) {
  if (!['approved', 'rejected'].includes(decision)) {
    throw new Error('decision must be "approved" or "rejected"');
  }

  return withTransaction(async (client) => {
    const res = await client.query(
      `UPDATE ai_approvals
       SET status = $2,
           decided_by_owner_id = $3,
           decided_at = NOW(),
           decision_note = $4
       WHERE id = $1
         AND status = 'pending'
         AND expires_at > NOW()
       RETURNING *`,
      [approvalId, decision, decidedByOwnerId, decisionNote]
    );
    if (!res.rowCount) {
      // Could be already decided or expired
      const existing = await client.query(
        `SELECT status, expires_at FROM ai_approvals WHERE id = $1`,
        [approvalId]
      );
      if (!existing.rowCount) throw new Error('Approval not found');
      if (existing.rows[0].status !== 'pending') {
        throw new Error(`Approval already ${existing.rows[0].status}`);
      }
      throw new Error('Approval has expired');
    }

    const approval = res.rows[0];

    await writeAuditEvent({
      actorType: 'human',
      actorOwnerId: decidedByOwnerId,
      eventType: `approval.${decision}`,
      entityType: 'ai_approval',
      entityId: approvalId,
      taskId: approval.task_id,
      metadata: { tool_key: approval.tool_key, note: decisionNote },
      client,
    });

    return approval;
  });
}

async function expireStaleApprovals() {
  const res = await query(
    `UPDATE ai_approvals
     SET status = 'expired'
     WHERE status = 'pending' AND expires_at <= NOW()
     RETURNING id`
  );
  return res.rowCount;
}

async function listPendingApprovals({ limit = 50 } = {}) {
  const res = await query(
    `SELECT a.*, ag.display_name AS agent_name, t.title AS task_title
     FROM ai_approvals a
     JOIN ai_agents ag ON ag.id = a.agent_id
     JOIN ai_tasks t ON t.id = a.task_id
     WHERE a.status = 'pending' AND a.expires_at > NOW()
     ORDER BY
       CASE a.risk_level WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
       a.requested_at
     LIMIT $1`,
    [limit]
  );
  return res.rows;
}

module.exports = {
  createApproval,
  decideApproval,
  expireStaleApprovals,
  listPendingApprovals,
};
