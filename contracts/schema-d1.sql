-- =============================================================================
-- 服务端建库 DDL · SQLite / Cloudflare D1 方言（server/cloudflare）
--
-- 权威性：本文件与 schema-web.sql 语义完全一致，差异仅在方言。
--         两文件的表/列集合一致性由 scripts/verify-schema.mjs 断言。
--
-- 与 PostgreSQL 版的差异（仅此三处）：
--   1. BIGINT / SMALLINT / BIGSERIAL → INTEGER
--      （SQLite 动态类型；自增主键写 INTEGER PRIMARY KEY AUTOINCREMENT）
--   2. 命名约束语法：CONSTRAINT ... CHECK 保留，行为一致
--   3. 其余（部分唯一索引 WHERE、外键、CHECK）D1 均原生支持，写法相同
--
-- 约定同 schema-web.sql：snake_case、epoch 毫秒时间戳、布尔 0/1、
-- 状态 TEXT + CHECK、JSON 存 TEXT、不存分数明细/证明材料/私钥。
-- =============================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------- 迁移版本表

CREATE TABLE IF NOT EXISTS schema_migrations (
    version    TEXT    NOT NULL PRIMARY KEY,
    applied_at INTEGER NOT NULL
);

-- ------------------------------------------------------- 管理员与后台会话

-- 管理员（服务商运维，非学校用户）
CREATE TABLE IF NOT EXISTS admin_user (
    id                   TEXT    NOT NULL PRIMARY KEY,
    username             TEXT    NOT NULL UNIQUE,
    -- cloudflare 架构为 PBKDF2-SHA256（Workers 无 scrypt）；与 web 库数据不互通（§7.1）
    password_hash        TEXT    NOT NULL,
    must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
    created_at           INTEGER NOT NULL,
    updated_at           INTEGER NOT NULL
);

-- 刷新令牌（决策 #40：登出即删除，无需每请求查吊销名单）
CREATE TABLE IF NOT EXISTS refresh_token (
    id            TEXT    NOT NULL PRIMARY KEY,
    admin_user_id TEXT    NOT NULL REFERENCES admin_user (id) ON DELETE CASCADE,
    -- 只存哈希，明文仅在签发时返回一次
    token_hash    TEXT    NOT NULL UNIQUE,
    expires_at    INTEGER NOT NULL,
    created_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_refresh_token_admin_user
    ON refresh_token (admin_user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_token_expires_at
    ON refresh_token (expires_at);

-- --------------------------------------------------------------- 单位与授权

-- 单位（level=1 学校 / level=2 书院；决策 #34：二级单位为唯一批次主体）
CREATE TABLE IF NOT EXISTS unit (
    id             TEXT    NOT NULL PRIMARY KEY,
    name           TEXT    NOT NULL,
    unit_type      TEXT    NOT NULL CHECK (unit_type IN ('college', 'department', 'other')),
    parent_id      TEXT    REFERENCES unit (id) ON DELETE RESTRICT,
    level          INTEGER NOT NULL CHECK (level IN (1, 2)),
    -- 单位公钥 JWK（JSON 存 TEXT）；私钥永不进入服务端
    public_key_jwk TEXT,
    status         TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL,
    -- 一级单位无父级，二级单位必须有父级
    CONSTRAINT unit_parent_level CHECK (
        (level = 1 AND parent_id IS NULL) OR (level = 2 AND parent_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_unit_parent_id ON unit (parent_id);
CREATE INDEX IF NOT EXISTS idx_unit_status_level ON unit (status, level);

-- 授权码（决策 #40：可续期，过期不强制重新激活；一个单位至多一条未作废授权码）
CREATE TABLE IF NOT EXISTS license (
    code        TEXT    NOT NULL PRIMARY KEY,
    unit_id     TEXT    NOT NULL REFERENCES unit (id) ON DELETE CASCADE,
    expires_at  INTEGER NOT NULL,
    status      TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked')),
    renewed_at  INTEGER,
    renew_count INTEGER NOT NULL DEFAULT 0 CHECK (renew_count >= 0),
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_license_unit_id ON license (unit_id);
CREATE INDEX IF NOT EXISTS idx_license_status ON license (status);
-- 一个单位至多一条未作废授权码；已作废的历史行保留审计轨迹，不占用名额
CREATE UNIQUE INDEX IF NOT EXISTS uq_license_active_unit
    ON license (unit_id) WHERE status <> 'revoked';

-- 单位令牌（决策 #29：写接口 Bearer 凭证，只存哈希，随授权作废/换机失效）
CREATE TABLE IF NOT EXISTS unit_token (
    id           TEXT    NOT NULL PRIMARY KEY,
    unit_id      TEXT    NOT NULL REFERENCES unit (id) ON DELETE CASCADE,
    -- 绑定管理端安装实例；换机后旧 install_id 的令牌一并失效
    install_id   TEXT    NOT NULL,
    -- 派生自哪个授权码：作废该码时级联失效其全部令牌
    license_code TEXT    NOT NULL REFERENCES license (code) ON DELETE CASCADE,
    token_hash   TEXT    NOT NULL UNIQUE,
    expires_at   INTEGER NOT NULL,
    status       TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
    created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_unit_token_unit_install
    ON unit_token (unit_id, install_id);
CREATE INDEX IF NOT EXISTS idx_unit_token_license_code
    ON unit_token (license_code);

-- 换机记录（决策 #40：自助换机 + 每月上限 3 次，超频转后台放行）
CREATE TABLE IF NOT EXISTS rebind_request (
    id          TEXT    NOT NULL PRIMARY KEY,
    unit_id     TEXT    NOT NULL REFERENCES unit (id) ON DELETE CASCADE,
    install_id  TEXT    NOT NULL,
    reason      TEXT,
    old_code    TEXT,
    new_code    TEXT,
    status      TEXT    NOT NULL CHECK (status IN ('self-served', 'pending', 'approved', 'rejected')),
    -- 频次计数月份（YYYY-MM）与该月序号
    month_key   TEXT    NOT NULL,
    month_count INTEGER NOT NULL CHECK (month_count >= 1),
    created_at  INTEGER NOT NULL,
    resolved_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_rebind_request_unit_month
    ON rebind_request (unit_id, month_key);
CREATE INDEX IF NOT EXISTS idx_rebind_request_status
    ON rebind_request (status);

-- ----------------------------------------------------------------- 配置模板

-- 配置模板（决策 #37：按 (id, version, revision) 保留历史行，published 不可编辑）
-- JSON 列一律以 _json 后缀命名，避免 unit / class / rank 等标识符在方言中的歧义。
CREATE TABLE IF NOT EXISTS config_template (
    id             TEXT    NOT NULL,
    unit_id        TEXT    NOT NULL REFERENCES unit (id) ON DELETE CASCADE,
    name           TEXT    NOT NULL,
    version        INTEGER NOT NULL CHECK (version >= 1),
    revision       INTEGER NOT NULL CHECK (revision >= 0),
    status         TEXT    NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
    -- 单位配置 schema 版本（unit-config.schema.json 的 schemaVersion）
    schema_version INTEGER NOT NULL DEFAULT 1,
    unit_json      TEXT    NOT NULL,
    class_json     TEXT    NOT NULL,
    student_json   TEXT    NOT NULL,
    dyf_json       TEXT    NOT NULL,
    calc_json      TEXT    NOT NULL,
    rank_json      TEXT    NOT NULL,
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL,
    PRIMARY KEY (id, version, revision)
);

CREATE INDEX IF NOT EXISTS idx_config_template_unit_id
    ON config_template (unit_id);
-- 同一模板 id 至多一个 published 版本（发布新版时旧版转 archived）
CREATE UNIQUE INDEX IF NOT EXISTS uq_config_template_published
    ON config_template (id) WHERE status = 'published';

-- --------------------------------------------------------------------- 批次

-- 批次（仅公开字段，不含私钥；决策 #33/#37）
CREATE TABLE IF NOT EXISTS batch (
    id                       TEXT    NOT NULL PRIMARY KEY,
    unit_id                  TEXT    NOT NULL REFERENCES unit (id) ON DELETE CASCADE,
    year                     INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2999),
    semester                 INTEGER NOT NULL CHECK (semester IN (1, 2)),
    is_test                  INTEGER NOT NULL DEFAULT 0 CHECK (is_test IN (0, 1)),
    status                   TEXT    NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'closed')),
    apply_start_at           INTEGER,
    apply_end_at             INTEGER,
    calc_mode                TEXT    NOT NULL CHECK (calc_mode IN ('weighted', 'formula')),
    calc_config              TEXT    NOT NULL,
    public_key_jwk           TEXT    NOT NULL,
    config_template_id       TEXT    NOT NULL,
    config_template_version  INTEGER NOT NULL CHECK (config_template_version >= 1),
    config_template_revision INTEGER NOT NULL CHECK (config_template_revision >= 0),
    created_at               INTEGER NOT NULL,
    updated_at               INTEGER NOT NULL,
    FOREIGN KEY (config_template_id, config_template_version, config_template_revision)
        REFERENCES config_template (id, version, revision) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_batch_unit_status
    ON batch (unit_id, status);
-- 活跃批次下发查询（接口 11）：正式优先、创建时间倒序
CREATE INDEX IF NOT EXISTS idx_batch_active_lookup
    ON batch (unit_id, status, is_test, created_at);
-- 正式批次在同一单位的同一学年学期唯一（测试批次不受限）
CREATE UNIQUE INDEX IF NOT EXISTS uq_batch_official_term
    ON batch (unit_id, year, semester) WHERE is_test = 0;

-- ----------------------------------------------------------------- 申请状态

-- 申请状态（数据最小化 + 隐私：不存学号/姓名/分数，applyId 只存 SHA-256 哈希）
-- 轮次制（决策 #30/#31）：单轮内单向推进，跨轮由一级发起且从 reviewing 开始。
CREATE TABLE IF NOT EXISTS apply_status (
    apply_id_hash     TEXT    NOT NULL,
    unit_id           TEXT    NOT NULL REFERENCES unit (id) ON DELETE CASCADE,
    batch_id          TEXT    NOT NULL REFERENCES batch (id) ON DELETE CASCADE,
    review_round      INTEGER NOT NULL DEFAULT 1 CHECK (review_round >= 1),
    status            TEXT    NOT NULL CHECK (status IN ('draft', 'submitted', 'imported', 'reviewing', 'confirmed')),
    -- 学生端 register 上报的最新版本（决策 #39）
    latest_revision   INTEGER CHECK (latest_revision IS NULL OR latest_revision >= 1),
    -- 管理端导入时上报的版本（与 latest_revision 比对提示索要最新版）
    imported_revision INTEGER CHECK (imported_revision IS NULL OR imported_revision >= 1),
    imported_at       INTEGER,
    created_at        INTEGER NOT NULL,
    updated_at        INTEGER NOT NULL,
    PRIMARY KEY (apply_id_hash, review_round)
);

CREATE INDEX IF NOT EXISTS idx_apply_status_batch
    ON apply_status (batch_id, status);
CREATE INDEX IF NOT EXISTS idx_apply_status_unit
    ON apply_status (unit_id);

-- ----------------------------------------------------------------- 审计日志

-- 审计日志（后台写操作 + 换机/续期/作废等授权生命周期事件）
CREATE TABLE IF NOT EXISTS audit_log (
    id            INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    admin_user_id TEXT    REFERENCES admin_user (id) ON DELETE SET NULL,
    action        TEXT    NOT NULL,
    target        TEXT    NOT NULL,
    detail        TEXT,
    ip            TEXT,
    created_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_log_created_at
    ON audit_log (created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_action
    ON audit_log (action);
CREATE INDEX IF NOT EXISTS idx_audit_log_target
    ON audit_log (target);
