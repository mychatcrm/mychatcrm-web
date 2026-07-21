-- Hotfix: every live omnichannel response job must carry the exact provider
-- connection. Historical rows remain readable for audit, but can never be
-- reclaimed or dispatched after this migration.

-- Definitively close only jobs for which the authorization audit already
-- proved the connection was missing. Nothing is deleted or requeued, so an
-- old lead reply cannot be sent late after the deploy.
UPDATE public.agent_response_jobs AS job
   SET status = 'cancelled',
       failed_reason = 'connection_missing_legacy_cancelled',
       completed_at = COALESCE(job.completed_at, now()),
       locked_at = NULL,
       claim_token = NULL,
       claim_expires_at = NULL,
       updated_at = now()
 WHERE job.connection_id IS NULL
   AND job.status IN ('pending', 'processing', 'failed')
   AND EXISTS (
     SELECT 1
       FROM public.agent_outbound_outbox AS outbox
      WHERE outbox.job_id = job.id
        AND outbox.authorization_status = 'blocked'
        AND outbox.authorization_reason = 'connection_missing'
   );

CREATE OR REPLACE FUNCTION public.enforce_agent_response_job_connection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('pending', 'processing')
     AND NULLIF(btrim(NEW.connection_id), '') IS NULL THEN
    RAISE EXCEPTION 'agent_job_connection_required'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS agent_response_jobs_require_connection
  ON public.agent_response_jobs;
CREATE TRIGGER agent_response_jobs_require_connection
BEFORE INSERT OR UPDATE OF connection_id, status
ON public.agent_response_jobs
FOR EACH ROW
EXECUTE FUNCTION public.enforce_agent_response_job_connection();

REVOKE ALL ON FUNCTION public.enforce_agent_response_job_connection()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_agent_response_job_connection()
  TO service_role;

COMMENT ON FUNCTION public.enforce_agent_response_job_connection() IS
  'Fails closed before persistence when a live omnichannel agent job lacks its exact provider connection.';
