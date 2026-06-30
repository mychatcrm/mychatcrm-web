-- Concede DELETE ao service_role na tabela system_notifications_log.
-- A migration original (20260514_system_agent.sql) só concedeu SELECT e INSERT.
-- Sem este GRANT os botões de apagar notificações são bloqueados silenciosamente pelo PostgreSQL.
GRANT DELETE ON TABLE public.system_notifications_log TO service_role;
