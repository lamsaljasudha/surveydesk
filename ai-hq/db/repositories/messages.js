// ai-hq/db/repositories/messages.js

const { query, withTransaction } = require('../../../db');
const { writeAuditEvent } = require('./audit');

async function sendMessage({
  threadId = null,
  parentMessageId = null,
  senderAgentId = null,
  senderOwnerId = null,
  senderIsSystem = false,
  recipientAgentId = null,
  recipientOwnerId = null,
  recipientIsSystem = false,
  subject = null,
  body,
  bodyFormat = 'text',
  priority = 'normal',
  relatedTaskId = null,
  intent = 'inform',
  requiresAck = false,
  expiresInHours = null,
  hopCount = 0,
}) {
  // Validate exactly one sender and one recipient
  const senderCount = [senderAgentId, senderOwnerId, senderIsSystem].filter(Boolean).length;
  const recipientCount = [recipientAgentId, recipientOwnerId, recipientIsSystem].filter(
    Boolean
  ).length;
  if (senderCount !== 1) throw new Error('Exactly one sender required');
  if (recipientCount !== 1) throw new Error('Exactly one recipient required');

  return withTransaction(async (client) => {
    const res = await client.query(
      `INSERT INTO ai_messages (
          thread_id, parent_message_id,
          sender_agent_id, sender_owner_id, sender_is_system,
          recipient_agent_id, recipient_owner_id, recipient_is_system,
          subject, body, body_format, priority, related_task_id,
          intent, requires_ack, expires_at, hop_count
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
                 CASE WHEN $16::int IS NULL THEN NULL
                      ELSE NOW() + ($16 || ' hours')::interval END,
                 $17)
       RETURNING *`,
      [
        threadId,
        parentMessageId,
        senderAgentId,
        senderOwnerId,
        senderIsSystem,
        recipientAgentId,
        recipientOwnerId,
        recipientIsSystem,
        subject,
        body,
        bodyFormat,
        priority,
        relatedTaskId,
        intent,
        requiresAck,
        expiresInHours,
        hopCount,
      ]
    );
    const msg = res.rows[0];

    await writeAuditEvent({
      actorType: senderIsSystem ? 'system' : senderOwnerId ? 'human' : 'agent',
      actorOwnerId: senderOwnerId,
      actorAgentId: senderAgentId,
      actorIsSystem: senderIsSystem,
      eventType: 'message.sent',
      entityType: 'ai_message',
      entityId: msg.id,
      taskId: relatedTaskId,
      metadata: { intent, priority, requires_ack: requiresAck },
      client,
    });

    return msg;
  });
}

async function markDelivered({ messageId }) {
  const res = await query(
    `UPDATE ai_messages
     SET status = 'delivered', delivered_at = NOW()
     WHERE id = $1 AND status = 'queued'
     RETURNING *`,
    [messageId]
  );
  return res.rows[0] || null;
}

async function markRead({ messageId }) {
  const res = await query(
    `UPDATE ai_messages
     SET status = 'read', read_at = NOW()
     WHERE id = $1 AND status IN ('queued','delivered')
     RETURNING *`,
    [messageId]
  );
  return res.rows[0] || null;
}

async function acknowledgeMessage({ messageId }) {
  const res = await query(
    `UPDATE ai_messages
     SET status = 'acked', ack_at = NOW()
     WHERE id = $1 AND requires_ack = TRUE AND status IN ('queued','delivered','read')
     RETURNING *`,
    [messageId]
  );
  return res.rows[0] || null;
}

async function listInbox({ agentId = null, ownerId = null, limit = 50 }) {
  const params = [limit];
  let filter;
  if (agentId) {
    params.push(agentId);
    filter = `recipient_agent_id = $${params.length}`;
  } else if (ownerId) {
    params.push(ownerId);
    filter = `recipient_owner_id = $${params.length}`;
  } else {
    throw new Error('Either agentId or ownerId required');
  }

  const res = await query(
    `SELECT * FROM ai_messages
     WHERE ${filter}
       AND status IN ('queued','delivered','read')
       AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY
       CASE priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
       created_at DESC
     LIMIT $1`,
    params
  );
  return res.rows;
}

module.exports = { sendMessage, markDelivered, markRead, acknowledgeMessage, listInbox };
