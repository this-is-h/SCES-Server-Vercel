-- =============================================================================
-- 迁移 0002 · 启用行级安全（RLS）—— Supabase 专用（仅 PostgreSQL 方言；D1 无 RLS）
--
-- 背景：Supabase 控制台对每张未启用 RLS 的表提示
--       "This table can be accessed by anyone via the Data API as RLS is disabled"。
--       默认情况下 anon / authenticated 角色对 public schema 的表持有 ALL 权限，
--       未启用 RLS 时即可经 Data API（PostgREST）直接读写全部业务数据。
--
-- 本迁移做两件事：
--   1. 全部 11 张表 ENABLE ROW LEVEL SECURITY；本迁移**不添加任何 permissive
--      policy**，未配置策略 = 该角色对表默认拒绝（0 行可见、不可写入）。
--   2. 纵深防御：回收 anon / authenticated 的表级 DML 权限，并设置默认权限
--      使后续迁移新建的表不再自动获得其权限（否则新增 policy 即等于完全放开）。
--
-- 为什么不影响本服务端：
--   - 应用以 `postgres` 角色（superuser）经事务池直连执行 SQL，superuser
--     无条件绕过 RLS；
--   - 全部客户端（Electron 管理端 / 微信端 / Web 前端）只调用 `/api/v1/*`
--     HTTP 接口，无 supabase-js / Data API 调用（已全仓 grep 确认）。
--
-- 若将来确有 Data API 需求：按最小授权原则单独新增 policy（例如
--   `CREATE POLICY admin_user_self ON admin_user
--      FOR ALL TO authenticated
--      USING (id = current_setting('request.jwt.claim.sub')::text)`），
--   不要恢复 anon / authenticated 的全表权限。
-- =============================================================================

ALTER TABLE admin_user      ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_token   ENABLE ROW LEVEL SECURITY;
ALTER TABLE unit            ENABLE ROW LEVEL SECURITY;
ALTER TABLE license         ENABLE ROW LEVEL SECURITY;
ALTER TABLE unit_token      ENABLE ROW LEVEL SECURITY;
ALTER TABLE rebind_request  ENABLE ROW LEVEL SECURITY;
ALTER TABLE config_template ENABLE ROW LEVEL SECURITY;
ALTER TABLE batch           ENABLE ROW LEVEL SECURITY;
ALTER TABLE apply_status    ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log       ENABLE ROW LEVEL SECURITY;
ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;

-- 回收 Data API 角色的表权限（Supabase 环境；非 Supabase 环境无这两个角色则跳过）
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') AND
       EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
        REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
        -- 使本用户（postgres）后续在 public 新建的表默认不再授予两者权限
        ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated;
    END IF;
END $$;
