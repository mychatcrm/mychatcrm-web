-- Agente interno do SaaS + log de notificações do sistema

CREATE TABLE IF NOT EXISTS public.system_notifications_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  to_number text NOT NULL,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed')),
  error text NULL,
  metadata jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS system_notifications_log_created_idx
  ON public.system_notifications_log (created_at DESC);

ALTER TABLE public.system_notifications_log ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON TABLE public.system_notifications_log TO service_role;

INSERT INTO public.tenant_agents (
  tenant_id,
  agent_id,
  display_name,
  system_prompt,
  active,
  metadata,
  created_at,
  updated_at
) VALUES (
  'tenant-system-internal',
  'mychatcrm-system-agent',
  'MyChatCRM System Agent',
  'Agente interno do SaaS MyChatCRM. Responsável por notificações automáticas do sistema via WhatsApp.',
  true,
  '{
    "agentId": "mychatcrm-system-agent",
    "tenantId": "tenant-system-internal",
    "name": "MyChatCRM System Agent",
    "description": "Agente interno do SaaS MyChatCRM. Responsável por notificações automáticas do sistema: handoff de atendimento, alertas de cobrança, avisos de uso, notificações de novos leads e qualquer comunicação interna que o SaaS precise realizar via WhatsApp. NÃO remover nem desativar — agente crítico do sistema.",
    "systemNote": "SISTEMA INTERNO — Este agente foi criado pelo fundador do MyChatCRM (Renato Lagares) para gerenciar todas as comunicações automáticas do SaaS. Versão: 1.0.0 — Data: 2026-05-14. Se você está lendo isso no código, este agente é parte da infraestrutura core do produto.",
    "tipo": "system",
    "permissoes": ["send_notifications", "handoff_alerts", "billing_alerts", "lead_alerts"],
    "ctaHandoffAtivo": false,
    "responseMode": "text",
    "isSystemAgent": true
  }'::jsonb,
  now(),
  now()
)
ON CONFLICT (tenant_id, agent_id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  system_prompt = EXCLUDED.system_prompt,
  active = EXCLUDED.active,
  metadata = EXCLUDED.metadata,
  updated_at = now();
