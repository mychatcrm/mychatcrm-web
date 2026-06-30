-- Adiciona coluna provider à tabela system_notifications_log.
-- DEFAULT 'evolution' mantém compatibilidade com todos os logs históricos.
ALTER TABLE system_notifications_log
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'evolution';
