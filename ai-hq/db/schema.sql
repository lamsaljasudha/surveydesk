-- AI HQ Phase 1 Schema — Standalone Database
-- No fake Survey Desk users table. Owner identity is internal to AI HQ.
-- Future Survey Desk integration: match ai_hq_owners.external_user_id to Survey Desk user UUID.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- TABLE 0: AI HQ Owners
-- ============================================================================
CREATE TABLE IF NOT EXISTS ai_hq_owners (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_user_id      UUID UNIQUE NOT NULL,
    display_name          VARCHAR(255) NOT NULL,
    role                  VARCHAR(20) NOT NULL DEFAULT 'owner'
                          CHECK (role IN ('owner','admin')),
    is_active             BOOLEAN NOT NULL DEFAULT TRUE,
    granted_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    granted_by_owner_id   UUID REFERENCES ai_hq_owners(id),
    revoked_at            TIMESTAMP WITH TIME ZONE,
    revoked_by_owner_id   UUID REFERENCES ai_hq_owners(id),
    revoke_reason         TEXT,
    created_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_hq_owners_active_external
    ON ai_hq_owners (external_user_id) WHERE is_active = TRUE;

-- ============================================================================
-- TABLE 1: AI Settings
-- ============================================================================
CREATE TABLE IF NOT EXISTS ai_settings (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scope_type            VARCHAR(20) NOT NULL DEFAULT 'global'
                          CHECK (scope_type IN ('global','department','agent')),
    scope_id              UUID,
    key                   VARCHAR(100) NOT NULL,
    value                 JSONB NOT NULL,
    value_type            VARCHAR(20) NOT NULL DEFAULT 'string'
                          CHECK (value_type IN ('string','number','boolean','json')),
    is_agent_readable     BOOLEAN NOT NULL DEFAULT FALSE,
    description           TEXT,
    updated_by_owner_id   UUID REFERENCES ai_hq_owners(id),
    updated_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_settings_scope_key
    ON ai_settings (scope_type, COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid), key);

-- ============================================================================
-- TABLE 2: AI Model Pricing
-- ============================================================================
CREATE TABLE IF NOT EXISTS ai_model_pricing (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model_id                VARCHAR(50) NOT NULL,
    input_price_per_1m_usd  NUMERIC(10,6) NOT NULL DEFAULT 0.75,
    output_price_per_1m_usd NUMERIC(10,6) NOT NULL DEFAULT 3.75,
    cached_price_per_1m_usd NUMERIC(10,6) NOT NULL DEFAULT 0.03125,
    currency                VARCHAR(3) NOT NULL DEFAULT 'USD',
    effective_from          DATE NOT NULL DEFAULT CURRENT_DATE,
    effective_to            DATE,
    UNIQUE (model_id, effective_from)
);

-- ============================================================================
-- TABLE 3: AI Workers
-- ============================================================================
CREATE TABLE IF NOT EXISTS ai_workers (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hostname            VARCHAR(255) NOT NULL,
    pid                 INTEGER NOT NULL,
    process_role        VARCHAR(50) NOT NULL DEFAULT 'executor',
    started_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    heartbeat_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    status              VARCHAR(20) NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','draining','dead')),
    concurrency_limit   INTEGER NOT NULL DEFAULT 5,
    version             VARCHAR(50),
    capability_tags     TEXT[] DEFAULT '{}'
);

-- ============================================================================
-- TABLE 4: AI Departments
-- ============================================================================
CREATE TABLE IF NOT EXISTS ai_departments (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                  VARCHAR(100) NOT NULL,
    code                  VARCHAR(50) NOT NULL UNIQUE,
    parent_department_id  UUID REFERENCES ai_departments(id),
    manager_agent_id      UUID,
    status                VARCHAR(20) NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active','archived')),
    created_by_owner_id   UUID REFERENCES ai_hq_owners(id),
    created_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- TABLE 5: AI Agents
-- ============================================================================
CREATE TABLE IF NOT EXISTS ai_agents (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    display_name          VARCHAR(100) NOT NULL,
    department_id         UUID NOT NULL REFERENCES ai_departments(id),
    manager_agent_id      UUID REFERENCES ai_agents(id),
    role_type             VARCHAR(30) NOT NULL,
    system_prompt         TEXT NOT NULL,
    model_id              VARCHAR(50) NOT NULL DEFAULT 'gemini-3.8-flash',
    employment_status     VARCHAR(20) NOT NULL DEFAULT 'active'
                          CHECK (employment_status IN ('active','suspended','terminated')),
    autonomy_level        VARCHAR(20) NOT NULL DEFAULT 'supervised'
                          CHECK (autonomy_level IN ('supervised','semi_autonomous','autonomous')),
    max_concurrent_tasks  INTEGER NOT NULL DEFAULT 3,
    max_tasks_per_day     INTEGER NOT NULL DEFAULT 50,
    max_retries_per_task  INTEGER NOT NULL DEFAULT 3,
    max_delegation_depth  INTEGER NOT NULL DEFAULT 3,
    created_by_owner_id   UUID REFERENCES ai_hq_owners(id),
    created_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_agents_dept_id UNIQUE (department_id, id)
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'fk_departments_manager'
    ) THEN
        ALTER TABLE ai_departments
        ADD CONSTRAINT fk_departments_manager
        FOREIGN KEY (id, manager_agent_id)
        REFERENCES ai_agents(department_id, id)
        DEFERRABLE INITIALLY DEFERRED;
    END IF;
END $$;

-- ============================================================================
-- TABLE 6: AI Agent Permissions
-- ============================================================================
CREATE TABLE IF NOT EXISTS ai_agent_permissions (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id              UUID NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
    permission_key        VARCHAR(100) NOT NULL,
    granted_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    granted_by_owner_id   UUID REFERENCES ai_hq_owners(id),
    UNIQUE (agent_id, permission_key)
);

-- ============================================================================
-- TABLE 7: AI Tasks
-- ============================================================================
CREATE TABLE IF NOT EXISTS ai_tasks (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id              UUID NOT NULL REFERENCES ai_agents(id),
    parent_task_id        UUID REFERENCES ai_tasks(id),
    delegation_depth      INTEGER NOT NULL DEFAULT 0 CHECK (delegation_depth >= 0),
    title                 VARCHAR(255) NOT NULL,
    objective             TEXT NOT NULL,
    priority              VARCHAR(20) NOT NULL DEFAULT 'normal'
                          CHECK (priority IN ('low','normal','high','critical')),
    status                VARCHAR(30) NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','running','completed','failed','cancelled','awaiting_approval')),
    progress_percentage   INTEGER DEFAULT 0 CHECK (progress_percentage BETWEEN 0 AND 100),
    progress_note         TEXT,
    deadline_at           TIMESTAMP WITH TIME ZONE,
    payload               JSONB NOT NULL DEFAULT '{}',
    result                JSONB,
    error_summary         TEXT,
    idempotency_key       VARCHAR(255) UNIQUE,
    attempts              INTEGER NOT NULL DEFAULT 0,
    max_attempts          INTEGER NOT NULL DEFAULT 3,
    next_retry_at         TIMESTAMP WITH TIME ZONE,
    lease_owner_worker_id UUID REFERENCES ai_workers(id),
    lease_epoch           INTEGER NOT NULL DEFAULT 0,
    lease_expires_at      TIMESTAMP WITH TIME ZONE,
    heartbeat_at          TIMESTAMP WITH TIME ZONE,
    tokens_used           INTEGER DEFAULT 0,
    cost_usd              NUMERIC(10,6) DEFAULT 0,
    created_by_owner_id   UUID REFERENCES ai_hq_owners(id),
    created_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    completed_at          TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_ai_tasks_status_priority
    ON ai_tasks (status, priority, deadline_at);
CREATE INDEX IF NOT EXISTS idx_ai_tasks_agent_status
    ON ai_tasks (agent_id, status);
CREATE INDEX IF NOT EXISTS idx_ai_tasks_lease
    ON ai_tasks (lease_expires_at) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS idx_ai_tasks_parent
    ON ai_tasks (parent_task_id) WHERE parent_task_id IS NOT NULL;

-- ============================================================================
-- TABLE 8: AI Task Attempts
-- ============================================================================
CREATE TABLE IF NOT EXISTS ai_task_attempts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id         UUID NOT NULL REFERENCES ai_tasks(id) ON DELETE CASCADE,
    attempt_no      INTEGER NOT NULL,
    worker_id       UUID NOT NULL REFERENCES ai_workers(id),
    lease_epoch     INTEGER NOT NULL,
    started_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    ended_at        TIMESTAMP WITH TIME ZONE,
    heartbeat_at    TIMESTAMP WITH TIME ZONE,
    status          VARCHAR(20) NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running','succeeded','failed','crashed')),
    error_class     VARCHAR(50),
    error_detail    TEXT,
    steps_count     INTEGER DEFAULT 0,
    tokens_used     INTEGER DEFAULT 0,
    cost_usd        NUMERIC(10,6) DEFAULT 0,
    UNIQUE (task_id, attempt_no)
);

-- ============================================================================
-- TABLE 9: AI Tool Executions
-- ============================================================================
CREATE TABLE IF NOT EXISTS ai_tool_executions (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key       VARCHAR(255) NOT NULL UNIQUE,
    task_id               UUID REFERENCES ai_tasks(id),
    attempt_id            UUID REFERENCES ai_task_attempts(id),
    agent_id              UUID NOT NULL REFERENCES ai_agents(id),
    tool_key              VARCHAR(100) NOT NULL,
    tool_version          VARCHAR(20) NOT NULL DEFAULT '1.0',
    params_canonical      JSONB NOT NULL,
    params_hash           VARCHAR(64) NOT NULL,
    side_effect_class     VARCHAR(30) NOT NULL
                          CHECK (side_effect_class IN ('read_only','write_idempotent','write_non_idempotent','external_side_effect')),
    state                 VARCHAR(30) NOT NULL DEFAULT 'reserved'
                          CHECK (state IN ('reserved','in_flight','succeeded','failed','unknown','reconciled')),
    provider_reference    VARCHAR(255),
    result                JSONB,
    error_detail          TEXT,
    started_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    finished_at           TIMESTAMP WITH TIME ZONE,
    reconciled_at         TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_ai_tool_executions_idempotency
    ON ai_tool_executions (idempotency_key);
CREATE INDEX IF NOT EXISTS idx_ai_tool_executions_state
    ON ai_tool_executions (state) WHERE state IN ('in_flight','unknown');

-- ============================================================================
-- TABLE 10: AI Task Steps
-- ============================================================================
CREATE TABLE IF NOT EXISTS ai_task_steps (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id               UUID NOT NULL REFERENCES ai_tasks(id) ON DELETE CASCADE,
    attempt_id            UUID NOT NULL REFERENCES ai_task_attempts(id) ON DELETE CASCADE,
    step_no               INTEGER NOT NULL,
    step_type             VARCHAR(30) NOT NULL
                          CHECK (step_type IN ('decision','tool_call','observation','final_answer')),
    decision_summary      TEXT,
    tool_execution_id     UUID REFERENCES ai_tool_executions(id),
    input_params          JSONB,
    output_result         JSONB,
    error_detail          TEXT,
    tokens_used           INTEGER DEFAULT 0,
    duration_ms           INTEGER,
    created_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (attempt_id, step_no)
);

CREATE INDEX IF NOT EXISTS idx_ai_task_steps_task_attempt
    ON ai_task_steps (task_id, attempt_id, step_no);

-- ============================================================================
-- TABLE 11: AI Approvals
-- ============================================================================
CREATE TABLE IF NOT EXISTS ai_approvals (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id                UUID NOT NULL REFERENCES ai_agents(id),
    task_id                 UUID NOT NULL REFERENCES ai_tasks(id),
    tool_execution_id       UUID NOT NULL REFERENCES ai_tool_executions(id),
    tool_key                VARCHAR(100) NOT NULL,
    params_canonical        JSONB NOT NULL,
    action_fingerprint      VARCHAR(64) NOT NULL,
    human_readable_summary  TEXT NOT NULL,
    risk_level              VARCHAR(20) NOT NULL DEFAULT 'medium'
                            CHECK (risk_level IN ('low','medium','high','critical')),
    requested_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    expires_at              TIMESTAMP WITH TIME ZONE NOT NULL,
    status                  VARCHAR(20) NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','approved','rejected','expired')),
    decided_by_owner_id     UUID REFERENCES ai_hq_owners(id),
    decided_at              TIMESTAMP WITH TIME ZONE,
    decision_note           TEXT,
    UNIQUE (tool_execution_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_approvals_status
    ON ai_approvals (status, requested_at);

-- ============================================================================
-- TABLE 12: AI Budgets
-- ============================================================================
CREATE TABLE IF NOT EXISTS ai_budgets (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scope_type              VARCHAR(20) NOT NULL
                            CHECK (scope_type IN ('global','department','agent')),
    agent_id                UUID REFERENCES ai_agents(id),
    department_id           UUID REFERENCES ai_departments(id),
    currency                VARCHAR(3) NOT NULL DEFAULT 'USD',
    daily_limit_usd         NUMERIC(10,2) NOT NULL DEFAULT 10.00,
    monthly_limit_usd       NUMERIC(10,2) NOT NULL DEFAULT 200.00,
    per_task_limit_usd      NUMERIC(10,2) NOT NULL DEFAULT 1.00,
    soft_alert_percentage   INTEGER NOT NULL DEFAULT 80
                            CHECK (soft_alert_percentage BETWEEN 0 AND 100),
    hard_stop               BOOLEAN NOT NULL DEFAULT TRUE,
    billing_timezone        VARCHAR(50) NOT NULL DEFAULT 'Asia/Kathmandu',
    effective_from          DATE NOT NULL DEFAULT CURRENT_DATE,
    effective_to            DATE,
    updated_by_owner_id     UUID REFERENCES ai_hq_owners(id),
    updated_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_budget_scope CHECK (
        (scope_type = 'global'     AND agent_id IS NULL     AND department_id IS NULL) OR
        (scope_type = 'department' AND agent_id IS NULL     AND department_id IS NOT NULL) OR
        (scope_type = 'agent'      AND agent_id IS NOT NULL AND department_id IS NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_budgets_global
    ON ai_budgets ((TRUE)) WHERE scope_type = 'global';
CREATE UNIQUE INDEX IF NOT EXISTS uq_budgets_department
    ON ai_budgets (department_id) WHERE scope_type = 'department';
CREATE UNIQUE INDEX IF NOT EXISTS uq_budgets_agent
    ON ai_budgets (agent_id) WHERE scope_type = 'agent';

-- ============================================================================
-- TABLE 13: AI Usage Ledger
-- ============================================================================
CREATE TABLE IF NOT EXISTS ai_usage_ledger (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id                UUID NOT NULL REFERENCES ai_agents(id),
    department_id           UUID NOT NULL REFERENCES ai_departments(id),
    task_id                 UUID REFERENCES ai_tasks(id),
    attempt_id              UUID REFERENCES ai_task_attempts(id),
    tool_execution_id       UUID REFERENCES ai_tool_executions(id),
    estimated_cost_usd      NUMERIC(10,6) NOT NULL,
    actual_cost_usd         NUMERIC(10,6),
    status                  VARCHAR(20) NOT NULL
                            CHECK (status IN ('reserved','settled','released','unknown','adjustment')),
    day_bucket              DATE NOT NULL,
    month_bucket            DATE NOT NULL,
    created_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    settled_at              TIMESTAMP WITH TIME ZONE,
    released_at             TIMESTAMP WITH TIME ZONE,
    adjustment_reason       TEXT,
    adjustment_by_owner_id  UUID REFERENCES ai_hq_owners(id)
);

CREATE INDEX IF NOT EXISTS idx_usage_ledger_agent_day
    ON ai_usage_ledger (agent_id, day_bucket);
CREATE INDEX IF NOT EXISTS idx_usage_ledger_dept_day
    ON ai_usage_ledger (department_id, day_bucket);
CREATE INDEX IF NOT EXISTS idx_usage_ledger_global_day
    ON ai_usage_ledger (day_bucket);
CREATE INDEX IF NOT EXISTS idx_usage_ledger_status
    ON ai_usage_ledger (status) WHERE status IN ('reserved','unknown');

-- ============================================================================
-- TABLE 14: AI Memory Items
-- ============================================================================
CREATE TABLE IF NOT EXISTS ai_memory_items (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scope                 VARCHAR(20) NOT NULL
                          CHECK (scope IN ('global','department','individual','task')),
    scope_id              UUID,
    owner_agent_id        UUID REFERENCES ai_agents(id),
    title                 VARCHAR(255) NOT NULL,
    content               TEXT NOT NULL,
    content_tsv           TSVECTOR GENERATED ALWAYS AS (
                              to_tsvector('english',
                                  coalesce(title,'') || ' ' || coalesce(content,''))
                          ) STORED,
    summary               TEXT,
    tags                  TEXT[] DEFAULT '{}',
    kind                  VARCHAR(30) NOT NULL DEFAULT 'fact'
                          CHECK (kind IN ('fact','decision','procedure','preference','summary')),
    source_type           VARCHAR(30),
    source_ref            VARCHAR(255),
    source_task_id        UUID REFERENCES ai_tasks(id),
    confidence            NUMERIC(3,2) DEFAULT 1.00
                          CHECK (confidence BETWEEN 0 AND 1),
    sensitivity           VARCHAR(20) NOT NULL DEFAULT 'internal'
                          CHECK (sensitivity IN ('public','internal','confidential','restricted')),
    version               INTEGER NOT NULL DEFAULT 1,
    supersedes_id         UUID REFERENCES ai_memory_items(id),
    is_active             BOOLEAN NOT NULL DEFAULT TRUE,
    expires_at            TIMESTAMP WITH TIME ZONE,
    created_by_owner_id   UUID REFERENCES ai_hq_owners(id),
    created_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_memory_items_search
    ON ai_memory_items USING GIN(content_tsv);
CREATE INDEX IF NOT EXISTS idx_ai_memory_items_scope
    ON ai_memory_items (scope, scope_id, is_active);
CREATE INDEX IF NOT EXISTS idx_ai_memory_items_agent
    ON ai_memory_items (owner_agent_id, is_active) WHERE scope = 'individual';

-- ============================================================================
-- TABLE 15: AI Messages
-- ============================================================================
CREATE TABLE IF NOT EXISTS ai_messages (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id             UUID,
    parent_message_id     UUID REFERENCES ai_messages(id),
    sender_agent_id       UUID REFERENCES ai_agents(id),
    sender_owner_id       UUID REFERENCES ai_hq_owners(id),
    sender_is_system      BOOLEAN NOT NULL DEFAULT FALSE,
    recipient_agent_id    UUID REFERENCES ai_agents(id),
    recipient_owner_id    UUID REFERENCES ai_hq_owners(id),
    recipient_is_system   BOOLEAN NOT NULL DEFAULT FALSE,
    subject               VARCHAR(255),
    body                  TEXT NOT NULL,
    body_format           VARCHAR(20) NOT NULL DEFAULT 'text'
                          CHECK (body_format IN ('text','markdown','json')),
    priority              VARCHAR(20) NOT NULL DEFAULT 'normal'
                          CHECK (priority IN ('low','normal','high','urgent')),
    related_task_id       UUID REFERENCES ai_tasks(id),
    intent                VARCHAR(30) NOT NULL DEFAULT 'inform'
                          CHECK (intent IN ('inform','request','response','escalate','ack')),
    requires_ack          BOOLEAN NOT NULL DEFAULT FALSE,
    status                VARCHAR(20) NOT NULL DEFAULT 'queued'
                          CHECK (status IN ('queued','delivered','read','acked','expired')),
    delivered_at          TIMESTAMP WITH TIME ZONE,
    read_at               TIMESTAMP WITH TIME ZONE,
    ack_at                TIMESTAMP WITH TIME ZONE,
    expires_at            TIMESTAMP WITH TIME ZONE,
    hop_count             INTEGER NOT NULL DEFAULT 0 CHECK (hop_count BETWEEN 0 AND 10),
    created_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_message_sender CHECK (
        (sender_agent_id IS NOT NULL)::integer +
        (sender_owner_id IS NOT NULL)::integer +
        (sender_is_system)::integer = 1
    ),
    CONSTRAINT chk_message_recipient CHECK (
        (recipient_agent_id IS NOT NULL)::integer +
        (recipient_owner_id IS NOT NULL)::integer +
        (recipient_is_system)::integer = 1
    )
);

CREATE INDEX IF NOT EXISTS idx_ai_messages_recipient
    ON ai_messages (recipient_agent_id, recipient_owner_id, status, priority);
CREATE INDEX IF NOT EXISTS idx_ai_messages_thread
    ON ai_messages (thread_id, created_at);

-- ============================================================================
-- TABLE 16: AI Audit Events (append-only, hash-chained)
-- ============================================================================
CREATE TABLE IF NOT EXISTS ai_audit_events (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    occurred_at           TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    actor_type            VARCHAR(20) NOT NULL
                          CHECK (actor_type IN ('human','agent','worker','system')),
    actor_owner_id        UUID REFERENCES ai_hq_owners(id),
    actor_agent_id        UUID REFERENCES ai_agents(id),
    actor_worker_id       UUID REFERENCES ai_workers(id),
    actor_is_system       BOOLEAN NOT NULL DEFAULT FALSE,
    event_type            VARCHAR(100) NOT NULL,
    entity_type           VARCHAR(50),
    entity_id             UUID,
    task_id               UUID REFERENCES ai_tasks(id),
    attempt_id            UUID REFERENCES ai_task_attempts(id),
    request_id            VARCHAR(100),
    ip_address            VARCHAR(45),
    user_agent            TEXT,
    before_redacted       JSONB,
    after_redacted        JSONB,
    metadata              JSONB DEFAULT '{}',
    sequence_no           BIGINT NOT NULL,
    prev_hash             VARCHAR(64),
    event_hash            VARCHAR(64) NOT NULL,
    CONSTRAINT chk_audit_actor_match CHECK (
        (actor_type = 'human'  AND actor_owner_id IS NOT NULL AND actor_agent_id IS NULL AND actor_worker_id IS NULL AND actor_is_system = FALSE) OR
        (actor_type = 'agent'  AND actor_owner_id IS NULL AND actor_agent_id IS NOT NULL AND actor_worker_id IS NULL AND actor_is_system = FALSE) OR
        (actor_type = 'worker' AND actor_owner_id IS NULL AND actor_agent_id IS NULL AND actor_worker_id IS NOT NULL AND actor_is_system = FALSE) OR
        (actor_type = 'system' AND actor_owner_id IS NULL AND actor_agent_id IS NULL AND actor_worker_id IS NULL AND actor_is_system = TRUE)
    )
);

CREATE INDEX IF NOT EXISTS idx_ai_audit_events_actor
    ON ai_audit_events (actor_type, actor_owner_id, actor_agent_id, actor_worker_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_ai_audit_events_task
    ON ai_audit_events (task_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_ai_audit_events_type
    ON ai_audit_events (event_type, occurred_at);
CREATE INDEX IF NOT EXISTS idx_ai_audit_events_sequence
    ON ai_audit_events (actor_type, actor_owner_id, actor_agent_id, actor_worker_id, sequence_no);

-- ============================================================================
-- SEED DATA
-- ============================================================================
INSERT INTO ai_model_pricing (model_id, input_price_per_1m_usd, output_price_per_1m_usd, cached_price_per_1m_usd, effective_from)
VALUES ('gemini-3.8-flash', 0.75, 3.75, 0.03125, CURRENT_DATE)
ON CONFLICT (model_id, effective_from) DO NOTHING;

INSERT INTO ai_settings (scope_type, scope_id, key, value, value_type, description)
VALUES
    ('global', NULL, 'gemini.model', '"gemini-3.8-flash"', 'string', 'Active Gemini model'),
    ('global', NULL, 'gemini.rpm_limit', '15', 'number', 'Requests per minute limit'),
    ('global', NULL, 'gemini.tpd_limit', '1000000', 'number', 'Tokens per day limit'),
    ('global', NULL, 'accounting.timezone', '"Asia/Kathmandu"', 'string', 'Accounting timezone'),
    ('global', NULL, 'ai_hq.bootstrap_completed', 'false', 'boolean', 'Bootstrap completion flag'),
    ('global', NULL, 'ai_hq.enabled', 'true', 'boolean', 'Master switch')
ON CONFLICT (scope_type, COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid), key) DO NOTHING;

-- ============================================================================
-- FUNCTIONS
-- ============================================================================
CREATE OR REPLACE FUNCTION ai_hq_write_audit_event(
    p_actor_type        TEXT,
    p_actor_owner_id    UUID,
    p_actor_agent_id    UUID,
    p_actor_worker_id   UUID,
    p_actor_is_system   BOOLEAN,
    p_event_type        TEXT,
    p_entity_type       TEXT,
    p_entity_id         UUID,
    p_task_id           UUID,
    p_attempt_id        UUID,
    p_metadata          JSONB
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor_key     TEXT;
    v_sequence_no   BIGINT;
    v_prev_hash     TEXT;
    v_event_hash    TEXT;
    v_id            UUID;
BEGIN
    v_actor_key := COALESCE(
        p_actor_owner_id::text,
        p_actor_agent_id::text,
        p_actor_worker_id::text,
        'system'
    );

    PERFORM pg_advisory_xact_lock(hashtext(v_actor_key));

    SELECT COALESCE(MAX(sequence_no), 0) + 1
      INTO v_sequence_no
      FROM ai_audit_events
     WHERE actor_type = p_actor_type
       AND COALESCE(actor_owner_id::text, actor_agent_id::text, actor_worker_id::text, 'system') = v_actor_key;

    SELECT event_hash
      INTO v_prev_hash
      FROM ai_audit_events
     WHERE actor_type = p_actor_type
       AND COALESCE(actor_owner_id::text, actor_agent_id::text, actor_worker_id::text, 'system') = v_actor_key
     ORDER BY sequence_no DESC
     LIMIT 1;

    v_id := gen_random_uuid();

    v_event_hash := encode(
        digest(
            COALESCE(v_prev_hash, '') ||
            v_id::text ||
            p_event_type ||
            COALESCE(p_entity_type, '') ||
            COALESCE(p_entity_id::text, '') ||
            COALESCE(p_metadata::text, '{}') ||
            v_sequence_no::text,
            'sha256'
        ),
        'hex'
    );

    INSERT INTO ai_audit_events (
        id, actor_type, actor_owner_id, actor_agent_id, actor_worker_id,
        actor_is_system, event_type, entity_type, entity_id,
        task_id, attempt_id, metadata, sequence_no, prev_hash, event_hash
    ) VALUES (
        v_id, p_actor_type, p_actor_owner_id, p_actor_agent_id, p_actor_worker_id,
        COALESCE(p_actor_is_system, FALSE), p_event_type, p_entity_type, p_entity_id,
        p_task_id, p_attempt_id, COALESCE(p_metadata, '{}'::jsonb),
        v_sequence_no, v_prev_hash, v_event_hash
    );

    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION ai_hq_forbid_audit_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'ai_audit_events is append-only. UPDATE and DELETE are forbidden.';
END;
$$;

DROP TRIGGER IF EXISTS trg_ai_audit_no_update ON ai_audit_events;
CREATE TRIGGER trg_ai_audit_no_update
    BEFORE UPDATE ON ai_audit_events
    FOR EACH ROW EXECUTE FUNCTION ai_hq_forbid_audit_mutation();

DROP TRIGGER IF EXISTS trg_ai_audit_no_delete ON ai_audit_events;
CREATE TRIGGER trg_ai_audit_no_delete
    BEFORE DELETE ON ai_audit_events
    FOR EACH ROW EXECUTE FUNCTION ai_hq_forbid_audit_mutation();