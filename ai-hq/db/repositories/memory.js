// ai-hq/db/repositories/memory.js
// Memory stores summaries, decisions, facts, procedures.
// Never store chain-of-thought. Always scoped.

const { query, withTransaction } = require('../../../db');

async function createMemory({
  scope,
  scopeId = null,
  ownerAgentId = null,
  title,
  content,
  summary = null,
  tags = [],
  kind = 'fact',
  sourceType = null,
  sourceRef = null,
  sourceTaskId = null,
  confidence = 1.0,
  sensitivity = 'internal',
  expiresAt = null,
  createdByOwnerId = null,
}) {
  if (!['global', 'department', 'individual', 'task'].includes(scope)) {
    throw new Error('Invalid scope');
  }
  if (scope === 'individual' && !ownerAgentId) {
    throw new Error('individual memory requires owner_agent_id');
  }
  if (scope === 'department' && !scopeId) {
    throw new Error('department memory requires scope_id');
  }
  if (scope === 'task' && !scopeId) {
    throw new Error('task memory requires scope_id');
  }

  return withTransaction(async (client) => {
    const res = await client.query(
      `INSERT INTO ai_memory_items (
          scope, scope_id, owner_agent_id, title, content, summary,
          tags, kind, source_type, source_ref, source_task_id,
          confidence, sensitivity, expires_at, created_by_owner_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [
        scope,
        scopeId,
        ownerAgentId,
        title,
        content,
        summary,
        tags,
        kind,
        sourceType,
        sourceRef,
        sourceTaskId,
        confidence,
        sensitivity,
        expiresAt,
        createdByOwnerId,
      ]
    );
    return res.rows[0];
  });
}

async function searchMemory({
  queryText,
  scopes = ['global'],
  agentId = null,
  limit = 20,
  minConfidence = 0,
}) {
  const params = [queryText, limit, minConfidence];
  const scopeConditions = [];
  let p = 3;

  for (const s of scopes) {
    if (s === 'individual') {
      p += 1;
      params.push(agentId);
      scopeConditions.push(`(scope = 'individual' AND owner_agent_id = $${p})`);
    } else {
      p += 1;
      params.push(s);
      scopeConditions.push(`scope = $${p}`);
    }
  }

  const res = await query(
    `SELECT id, scope, scope_id, owner_agent_id, title, summary, tags, kind, confidence,
            ts_rank(content_tsv, plainto_tsquery('english', $1)) AS rank
     FROM ai_memory_items
     WHERE is_active = TRUE
       AND (expires_at IS NULL OR expires_at > NOW())
       AND confidence >= $3
       AND content_tsv @@ plainto_tsquery('english', $1)
       AND (${scopeConditions.join(' OR ')})
     ORDER BY rank DESC, confidence DESC
     LIMIT $2`,
    params
  );
  return res.rows;
}

async function supersedeMemory({ oldMemoryId, newMemoryData, createdByOwnerId }) {
  return withTransaction(async (client) => {
    const old = await client.query(
      `SELECT * FROM ai_memory_items WHERE id = $1 AND is_active = TRUE`,
      [oldMemoryId]
    );
    if (!old.rowCount) throw new Error('Memory not found or inactive');
    const prev = old.rows[0];

    const created = await client.query(
      `INSERT INTO ai_memory_items (
          scope, scope_id, owner_agent_id, title, content, summary,
          tags, kind, source_type, source_ref, source_task_id,
          confidence, sensitivity, version, supersedes_id, created_by_owner_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING *`,
      [
        newMemoryData.scope,
        newMemoryData.scopeId,
        newMemoryData.ownerAgentId,
        newMemoryData.title,
        newMemoryData.content,
        newMemoryData.summary,
        newMemoryData.tags || [],
        newMemoryData.kind || 'fact',
        newMemoryData.sourceType,
        newMemoryData.sourceRef,
        newMemoryData.sourceTaskId,
        newMemoryData.confidence || 1.0,
        newMemoryData.sensitivity || 'internal',
        prev.version + 1,
        oldMemoryId,
        createdByOwnerId,
      ]
    );

    await client.query(
      `UPDATE ai_memory_items SET is_active = FALSE, updated_at = NOW() WHERE id = $1`,
      [oldMemoryId]
    );

    return created.rows[0];
  });
}

module.exports = { createMemory, searchMemory, supersedeMemory };
