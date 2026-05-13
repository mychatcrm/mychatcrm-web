-- Extended media metadata for whatsapp_messages (video + future analysis pipeline).
-- Safe to re-run: all columns use IF NOT EXISTS.

alter table public.whatsapp_messages
  add column if not exists mime_type text,
  add column if not exists storage_key text,
  add column if not exists file_name text,
  add column if not exists caption text,
  add column if not exists media_duration_seconds integer,
  add column if not exists thumbnail_url text,
  add column if not exists transcription_status text,
  add column if not exists analysis_status text,
  add column if not exists ai_description text;

create index if not exists whatsapp_messages_tenant_jid_created_idx
  on public.whatsapp_messages (tenant_id, remote_jid, created_at desc);
