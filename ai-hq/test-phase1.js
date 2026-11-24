const agents = require('./db/repositories/agents');
const tasks = require('./db/repositories/tasks');
const budgets = require('./db/repositories/budgets');
const audit = require('./db/repositories/audit');
const owners = require('./db/repositories/owners');
const { query } = require('../db');

async function test() {
  console.log('Testing Phase 1 repositories...\n');

  // Test 1: Create department
  console.log('1. Creating department...');
  const dept = await query(
    `INSERT INTO ai_departments (name, code, status) VALUES ($1, $2, $3) RETURNING *`,
    ['Operations', 'OPS', 'active']
  );
  console.log('   ✓ Department created:', dept.rows[0].id);

  // Test 2: Create agent
  console.log('2. Creating agent...');
  const agent = await agents.createAgent({
    displayName: 'Managing Director',
    departmentId: dept.rows[0].id,
    roleType: 'managing_director',
    systemPrompt: 'You are the Managing Director of AI Headquarters.',
    createdByUserId: null,
  });
  console.log('   ✓ Agent created:', agent.id);

  // Test 3: Grant permission
  console.log('3. Granting permission...');
  await agents.grantPermission(agent.id, 'tool.search_cases', null);
  const perms = await agents.getAgentPermissions(agent.id);
  console.log('   ✓ Permissions:', perms);

  // Test 4: Create task
  console.log('4. Creating task...');
  const task = await tasks.createTask({
    agentId: agent.id,
    title: 'Test Task',
    objective: 'Verify Phase 1 implementation',
    priority: 'high',
  });
  console.log('   ✓ Task created:', task.id);

  // Test 5: Write audit event
  console.log('5. Writing audit event...');
  const auditId = await audit.writeAuditEvent({
    actorType: 'system',
    actorIsSystem: true,
    eventType: 'phase1_test',
    entityType: 'ai_agent',
    entityId: agent.id,
    metadata: { test: true },
  });
  console.log('   ✓ Audit event written:', auditId);

  // Test 6: Create budget
  console.log('6. Creating budget...');
  await query(
    `INSERT INTO ai_budgets (scope_type, agent_id, department_id, daily_limit_usd, monthly_limit_usd)
         VALUES ('agent', $1, $2, 10.00, 200.00)`,
    [agent.id, dept.rows[0].id]
  );
  console.log('   ✓ Budget created');

  // Test 7: Reserve budget
  console.log('7. Reserving budget...');
  const reservationId = await budgets.reserveBudget(agent.id, 0.05, task.id, null, null);
  console.log('   ✓ Budget reserved:', reservationId);

  // Test 8: Settle budget
  console.log('8. Settling budget...');
  await budgets.settleBudget(reservationId, 0.03);
  console.log('   ✓ Budget settled');

  console.log('\n✅ All Phase 1 tests passed!');
}

test().catch((error) => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
