// ai-hq/db/repositories/departments.js

const { query, withTransaction } = require('../../../db');
const { writeAuditEvent } = require('./audit');

async function createDepartment({
  name,
  code,
  parentDepartmentId = null,
  createdByOwnerId = null,
}) {
  return withTransaction(async (client) => {
    const res = await client.query(
      `INSERT INTO ai_departments (name, code, parent_department_id, created_by_owner_id)
       VALUES ($1,$2,$3,$4)
       RETURNING *`,
      [name, code, parentDepartmentId, createdByOwnerId]
    );
    const dept = res.rows[0];

    await writeAuditEvent({
      actorType: createdByOwnerId ? 'human' : 'system',
      actorOwnerId: createdByOwnerId,
      actorIsSystem: !createdByOwnerId,
      eventType: 'department.created',
      entityType: 'ai_department',
      entityId: dept.id,
      metadata: { code, parent_department_id: parentDepartmentId },
      client,
    });

    return dept;
  });
}

async function getDepartment(deptId) {
  const res = await query('SELECT * FROM ai_departments WHERE id = $1', [deptId]);
  return res.rows[0] || null;
}

async function listDepartments() {
  const res = await query(
    `SELECT d.*, COUNT(a.id) AS agent_count
     FROM ai_departments d
     LEFT JOIN ai_agents a ON a.department_id = d.id AND a.employment_status = 'active'
     WHERE d.status = 'active'
     GROUP BY d.id
     ORDER BY d.name`
  );
  return res.rows;
}

async function setManager({ departmentId, managerAgentId, updatedByOwnerId }) {
  return withTransaction(async (client) => {
    // Verify agent belongs to the department before assigning as manager
    const check = await client.query(
      `SELECT 1 FROM ai_agents WHERE id = $1 AND department_id = $2`,
      [managerAgentId, departmentId]
    );
    if (!check.rowCount) {
      throw new Error('Manager agent must belong to the department');
    }

    const res = await client.query(
      `UPDATE ai_departments
       SET manager_agent_id = $2, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [departmentId, managerAgentId]
    );

    await writeAuditEvent({
      actorType: updatedByOwnerId ? 'human' : 'system',
      actorOwnerId: updatedByOwnerId,
      actorIsSystem: !updatedByOwnerId,
      eventType: 'department.manager.set',
      entityType: 'ai_department',
      entityId: departmentId,
      metadata: { manager_agent_id: managerAgentId },
      client,
    });

    return res.rows[0];
  });
}

module.exports = { createDepartment, getDepartment, listDepartments, setManager };
