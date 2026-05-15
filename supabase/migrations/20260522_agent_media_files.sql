-- Arquivos de mídia que o agente pode enviar automaticamente aos clientes (R2 + metadados).
-- Inclui estado `uploading` para reservar o slot durante o fluxo presigned.

CREATE TABLE IF NOT EXISTS public.agent_media_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  agent_id text NOT NULL,
  original_filename text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL DEFAULT 0,
  storage_key text NOT NULL,
  description text NULL,
  status text NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading', 'ready', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_media_files_tenant_agent_idx
  ON public.agent_media_files (tenant_id, agent_id);

ALTER TABLE public.agent_media_files ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_media_files TO service_role;
