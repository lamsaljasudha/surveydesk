// ai-hq/db/repositories/agents.js
// Agents cannot modify their own permissions, roles, or autonomy.
// All such changes must go through owner-facing functions which audit.

const { query, withTransaction } = require('../../../db');
const { writeAuditEvent } = require('./audit');

async function createAgent({
  displayName,
  departmentId,
  roleType,
  systemPrompt,
  modelId = 'gemini-3.8-flash',
  managerAgentId = null,
  createdByOwnerId = null,
}) {
  return withTransaction(async (client) => {
    const res = await client.query(
      `INSERT INTO ai_agents (
          display_name, department_id, role_type, system_prompt, model_id,
          manager_agent_id, created_by_owner_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [displayName, departmentId, roleType, systemPrompt, modelId, managerAgentId, createdByOwnerId]
    );
    const agent = res.rows[0];

    await writeAuditEvent({
      actorType: createdByOwnerId ? 'human' : 'system',
      actorOwnerId: createdByOwnerId,
      actorIsSystem: !createdByOwnerId,
      eventType: 'agent.created',
      entityType: 'ai_agent',
      entityId: agent.id,
      metadata: { department_id: departmentId, role_type: roleType },
      client,
    });

    return agent;
  });
}

async function getAgent(agentId) {
  const res = await query('SELECT * FROM ai_agents WHERE id = $1', [agentId]);
  return res.rows[0] || null;
}

async function listAgentsByDepartment(departmentId) {
  const res = await query(
    `SELECT * FROM ai_agents
     WHERE department_id = $1 AND employment_status = 'active'
     ORDER BY display_name`,
    [departmentId]
  );
  return res.rows;
}

async function grantPermission({ agentId, permissionKey, grantedByOwnerId }) {
  return withTransaction(async (client) => {
    const res = await client.query(
      `INSERT INTO ai_agent_permissions (agent_id, permission_key, granted_by_owner_id)
       VALUES ($1,$2,$3)
       ON CONFLICT (agent_id, permission_key) DO NOTHING
       RETURNING *`,
      [agentId, permissionKey, grantedByOwnerId]
    );
    if (res.rowCount) {
      await writeAuditEvent({
        actorType: 'human',
        actorOwnerId: grantedByOwnerId,
        eventType: 'agent.permission.granted',
        entityType: 'ai_agent',
        entityId: agentId,
        metadata: { permission_key: permissionKey },
        client,
      });
    }
    return res.rows[0] || null;
  });
}

async function revokePermission({ agentId, permissionKey, revokedByOwnerId }) {
  return withTransaction(async (client) => {
    const res = await client.query(
      `DELETE FROM ai_agent_permissions
       WHERE agent_id = $1 AND permission_key = $2
       RETURNING *`,
      [agentId, permissionKey]
    );
    if (res.rowCount) {
      await writeAuditEvent({
        actorType: 'human',
        actorOwnerId: revokedByOwnerId,
        eventType: 'agent.permission.revoked',
        entityType: 'ai_agent',
        entityId: agentId,
        metadata: { permission_key: permissionKey },
        client,
      });
    }
    return res.rowCount > 0;
  });
}

async function listPermissions(agentId) {
  const res = await query(
    `SELECT permission_key, granted_at, granted_by_owner_id
     FROM ai_agent_permissions WHERE agent_id = $1 ORDER BY permission_key`,
    [agentId]
  );
  return res.rows;
}

async function hasPermission(agentId, permissionKey) {
  const res = await query(
    `SELECT 1 FROM ai_agent_permissions
     WHERE agent_id = $1 AND permission_key = $2 LIMIT 1`,
    [agentId, permissionKey]
  );
  return res.rowCount > 0;
}

module.exports = {
  createAgent,
  getAgent,
  listAgentsByDepartment,
  grantPermission,
  revokePermission,
  listPermissions,
  hasPermission,
};
