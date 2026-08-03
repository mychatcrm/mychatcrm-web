-- Production history reconciliation.
-- The idempotent schema body is already versioned in
-- 20260728204111_meta_lead_connection_health.sql and was applied to production
-- under this timestamp. Keeping this marker aligns clean clones with the
-- remote migration ledger without replaying the same large migration twice.
select 1;
