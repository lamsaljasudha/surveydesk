// ai-hq/db/repositories/budgets.js
// Budget reservation with concurrent safety.
// Lock order: global → department → agent (canonical, prevents deadlocks).

const { query, withTransaction } = require('../../../db');

class BudgetNotConfiguredError extends Error {
  constructor(scope) {
    super(`Budget not configured for scope: ${scope}`);
    this.name = 'BudgetNotConfiguredError';
    this.scope = scope;
  }
}

class BudgetExceededError extends Error {
  constructor(scope, period) {
    super(`Budget exceeded for scope: ${scope}, period: ${period}`);
    this.name = 'BudgetExceededError';
    this.scope = scope;
    this.period = period;
  }
}

async function _computeSpent(client, { scopeType, agentId, departmentId, dayBucket }) {
  // Build a parameterized WHERE clause; no string interpolation of IDs.
  const params = [dayBucket, scopeType];
  let filter = '';
  if (scopeType === 'department') {
    params.push(departmentId);
    filter = `AND department_id = $${params.length}`;
  } else if (scopeType === 'agent') {
    params.push(agentId);
    filter = `AND agent_id = $${params.length}`;
  }

  const result = await client.query(
    `SELECT COALESCE(
        SUM(CASE WHEN status = 'settled' THEN actual_cost_usd ELSE 0 END)
      + SUM(CASE WHEN status IN ('reserved','unknown') THEN estimated_cost_usd ELSE 0 END)
      , 0) AS spent
     FROM ai_usage_ledger
     WHERE day_bucket = $1
       AND (
         $2 = 'global'
         OR ($2 = 'department' AND department_id IS NOT DISTINCT FROM $3)
         OR ($2 = 'agent'      AND agent_id      IS NOT DISTINCT FROM $3)
       )
       ${filter.replace(/^AND/, 'AND')}`,
    params
  );
  return parseFloat(result.rows[0].spent || 0);
}

async function reserveBudget({ agentId, taskId, attemptId, toolExecutionId, estimatedCost }) {
  if (!(estimatedCost > 0)) {
    throw new Error('estimatedCost must be > 0');
  }

  return withTransaction(async (client) => {
    // Lock agent row to freeze department assignment during check
    const agentRes = await client.query(
      `SELECT department_id FROM ai_agents WHERE id = $1 FOR UPDATE`,
      [agentId]
    );
    if (!agentRes.rowCount) throw new Error('Agent not found');
    const departmentId = agentRes.rows[0].department_id;

    // Lock budgets in canonical order (single statement, ordered FOR UPDATE)
    const budgetRes = await client.query(
      `SELECT * FROM ai_budgets
       WHERE scope_type = 'global'
          OR (scope_type = 'department' AND department_id = $1)
          OR (scope_type = 'agent'      AND agent_id      = $2)
       ORDER BY CASE scope_type WHEN 'global' THEN 1 WHEN 'department' THEN 2 ELSE 3 END
       FOR UPDATE`,
      [departmentId, agentId]
    );

    const budgets = { global: null, department: null, agent: null };
    for (const row of budgetRes.rows) budgets[row.scope_type] = row;
    if (!budgets.global) throw new BudgetNotConfiguredError('global');
    if (!budgets.department) throw new BudgetNotConfiguredError('department');
    if (!budgets.agent) throw new BudgetNotConfiguredError('agent');

    const timezone = budgets.global.billing_timezone || 'Asia/Kathmandu';
    const now = new Date();
    const dayBucket = now.toLocaleDateString('en-CA', { timeZone: timezone });
    const monthBucket = now.toLocaleDateString('en-CA', { timeZone: timezone, day: '1' });

    const spentGlobal = await _computeSpent(client, { scopeType: 'global', dayBucket });
    const spentDept = await _computeSpent(client, {
      scopeType: 'department',
      departmentId,
      dayBucket,
    });
    const spentAgent = await _computeSpent(client, { scopeType: 'agent', agentId, dayBucket });

    // Daily limits (global, department)
    if (
      budgets.global.hard_stop &&
      spentGlobal + estimatedCost > Number(budgets.global.daily_limit_usd)
    ) {
      throw new BudgetExceededError('global', 'daily');
    }
    if (
      budgets.department.hard_stop &&
      spentDept + estimatedCost > Number(budgets.department.daily_limit_usd)
    ) {
      throw new BudgetExceededError('department', 'daily');
    }

    // Per-task limit (agent budget) applies to this single task
    if (budgets.agent.hard_stop && estimatedCost > Number(budgets.agent.per_task_limit_usd)) {
      throw new BudgetExceededError('agent', 'task');
    }
    // Daily limit for agent
    if (
      budgets.agent.hard_stop &&
      spentAgent + estimatedCost > Number(budgets.agent.daily_limit_usd)
    ) {
      throw new BudgetExceededError('agent', 'daily');
    }

    // Monthly limits
    const monthRes = await client.query(
      `SELECT COALESCE(
          SUM(CASE WHEN status = 'settled' THEN actual_cost_usd ELSE 0 END)
        + SUM(CASE WHEN status IN ('reserved','unknown') THEN estimated_cost_usd ELSE 0 END)
        , 0) AS spent
       FROM ai_usage_ledger WHERE month_bucket = $1`,
      [monthBucket]
    );
    const monthSpent = parseFloat(monthRes.rows[0].spent || 0);
    if (
      budgets.global.hard_stop &&
      monthSpent + estimatedCost > Number(budgets.global.monthly_limit_usd)
    ) {
      throw new BudgetExceededError('global', 'monthly');
    }

    const insert = await client.query(
      `INSERT INTO ai_usage_ledger (
          agent_id, department_id, task_id, attempt_id, tool_execution_id,
          estimated_cost_usd, status, day_bucket, month_bucket
       ) VALUES ($1,$2,$3,$4,$5,$6,'reserved',$7,$8)
       RETURNING id`,
      [
        agentId,
        departmentId,
        taskId,
        attemptId,
        toolExecutionId,
        estimatedCost,
        dayBucket,
        monthBucket,
      ]
    );
    return insert.rows[0].id;
  });
}

async function settleBudget({ reservationId, actualCost }) {
  return withTransaction(async (client) => {
    const res = await client.query(
      `UPDATE ai_usage_ledger
       SET status = 'settled', actual_cost_usd = $2, settled_at = NOW()
       WHERE id = $1 AND status = 'reserved'
       RETURNING id`,
      [reservationId, actualCost]
    );
    if (!res.rowCount) {
      // Could be already settled/unknown — do not throw to avoid double-charge retries.
      return { id: reservationId, changed: false };
    }
    return { id: reservationId, changed: true };
  });
}

async function releaseBudget({ reservationId, reason = 'released' }) {
  return withTransaction(async (client) => {
    const res = await client.query(
      `UPDATE ai_usage_ledger
       SET status = 'released', released_at = NOW(), adjustment_reason = $2
       WHERE id = $1 AND status = 'reserved'
       RETURNING id`,
      [reservationId, reason]
    );
    return { id: reservationId, changed: res.rowCount > 0 };
  });
}

async function markUncertain({ reservationId, reason }) {
  // Use when API outcome is unknown; do NOT refund spend.
  return withTransaction(async (client) => {
    const res = await client.query(
      `UPDATE ai_usage_ledger
       SET status = 'unknown', adjustment_reason = $2
       WHERE id = $1 AND status = 'reserved'
       RETURNING id`,
      [reservationId, reason]
    );
    return { id: reservationId, changed: res.rowCount > 0 };
  });
}

module.exports = {
  reserveBudget,
  settleBudget,
  releaseBudget,
  markUncertain,
  BudgetNotConfiguredError,
  BudgetExceededError,
};
