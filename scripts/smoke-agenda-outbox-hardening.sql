-- Smoke SQL transacional (1 conexão) — NÃO prova concorrência.
-- Executar em branch/local; sempre ROLLBACK. Dados 100% sintéticos.
-- Dual-connection claim test: ver scripts/smoke-agenda-claim-dual.mjs

BEGIN;

DO $$
DECLARE
  v_sig text;
BEGIN
  SELECT pg_get_function_identity_arguments(p.oid)
    INTO v_sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'apply_agent_agenda_mutation'
   LIMIT 1;

  IF v_sig IS NULL OR position('p_job_id uuid' in v_sig) = 0 THEN
    RAISE EXCEPTION 'expected apply_agent_agenda_mutation with p_job_id uuid, got: %', v_sig;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'apply_agent_agenda_mutation'
       AND pg_get_function_identity_arguments(p.oid) LIKE '%p_job_id text%'
  ) THEN
    RAISE EXCEPTION 'text overload of p_job_id still present';
  END IF;

  IF to_regprocedure('public.list_missing_agenda_notification_ops(timestamptz,uuid,integer)') IS NULL THEN
    RAISE EXCEPTION 'list_missing_agenda_notification_ops missing';
  END IF;
END $$;

-- invalid_job_params: job sem generation
DO $$
BEGIN
  PERFORM public.apply_agent_agenda_mutation(
    'smoke-tenant-agenda-fix',
    'smoke-op-partial',
    'schedule',
    '5511999990000',
    NULL,
    'Smoke',
    NULL,
    NULL,
    now() + interval '2 days',
    now() + interval '2 days 1 hour',
    'Smoke',
    NULL,
    NULL,
    true,
    '00000000-0000-4000-8000-000000000099'::uuid,
    NULL,
    NULL
  );
  RAISE EXCEPTION 'expected invalid_job_params';
EXCEPTION
  WHEN others THEN
    IF SQLERRM <> 'invalid_job_params' THEN
      RAISE;
    END IF;
END $$;

ROLLBACK;
