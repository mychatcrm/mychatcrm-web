-- Statuses adicionais para fallback seguro do smart wait
comment on column public.agent_response_jobs.status is
  'pending | processing | completed | completed_with_fallback | cancelled | failed | failed_with_fallback';
