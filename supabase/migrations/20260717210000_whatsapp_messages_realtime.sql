-- Habilita Realtime na inbox WhatsApp (dashboard/conversas).
-- Idempotente: se a tabela já estiver na publication, ignora.

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_messages;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
