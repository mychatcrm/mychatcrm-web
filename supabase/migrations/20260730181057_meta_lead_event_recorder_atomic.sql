-- Source reconciliation for the atomic event recorder migration already applied in production.
create or replace function public.append_meta_lead_event_step(p_event_id uuid,p_step text,p_at timestamptz,p_detail jsonb default null)
returns boolean language plpgsql set search_path=''
as $$ declare affected_rows integer; step_entry jsonb; begin
  if p_event_id is null or nullif(pg_catalog.btrim(p_step),'') is null or pg_catalog.length(p_step)>128 or p_at is null then raise exception 'invalid_meta_lead_event_step'; end if;
  if p_detail is not null and pg_catalog.jsonb_typeof(p_detail)<>'object' then raise exception 'invalid_meta_lead_event_step_detail'; end if;
  step_entry:=pg_catalog.jsonb_build_object('step',pg_catalog.btrim(p_step),'at',p_at);
  if p_detail is not null then step_entry:=step_entry||pg_catalog.jsonb_build_object('detail',p_detail); end if;
  update public.meta_lead_events set current_step=pg_catalog.btrim(p_step),steps_log=coalesce(steps_log,'[]'::jsonb)||pg_catalog.jsonb_build_array(step_entry),error_message=case when pg_catalog.jsonb_typeof(p_detail->'error_message')='string' then p_detail->>'error_message' else error_message end,updated_at=p_at where id=p_event_id;
  get diagnostics affected_rows=row_count; return affected_rows=1;
end $$;
revoke all on function public.append_meta_lead_event_step(uuid,text,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.append_meta_lead_event_step(uuid,text,timestamptz,jsonb) to service_role;
