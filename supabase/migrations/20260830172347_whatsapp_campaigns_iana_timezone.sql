-- Universal civil time for WhatsApp campaigns.
--
-- The timezone is copied from the linked agent only during backfill/creation.
-- From then on it belongs to the campaign and can be edited independently.
-- No country is guessed and no historical recipient is replayed.

create schema if not exists private;

alter table public.whatsapp_campaigns
  add column if not exists timezone text null;

comment on column public.whatsapp_campaigns.timezone is
  'Explicit IANA timezone used by this campaign for civil dates, schedule and send windows.';

-- Backfill only when the linked agent proves an exact IANA zone. There is no
-- UTC or country-specific fallback: an unknown legacy configuration must be
-- reviewed by its operator before another message can be sent.
update public.whatsapp_campaigns campaign
   set timezone = btrim(agent.metadata->>'timezone')
  from public.tenant_agents agent
 where campaign.tenant_id = agent.tenant_id
   and campaign.agent_id = agent.agent_id
   and campaign.timezone is null
   and exists (
     select 1
       from pg_catalog.pg_timezone_names timezone_name
      where timezone_name.name = btrim(agent.metadata->>'timezone')
   );

update public.whatsapp_campaigns
   set status = 'review_required',
       review_reason = 'campaign_timezone_required',
       updated_at = clock_timestamp()
 where timezone is null
   and status in ('draft', 'scheduled', 'processing', 'paused');

create or replace function private.validate_whatsapp_campaign_timezone_v1()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if new.timezone is not null and not exists (
    select 1
      from pg_catalog.pg_timezone_names timezone_name
     where timezone_name.name = btrim(new.timezone)
  ) then
    raise exception using
      errcode = '22023',
      message = 'campaign_timezone_invalid';
  end if;

  if new.timezone is not null then
    new.timezone := btrim(new.timezone);
  end if;

  if new.status in ('draft', 'scheduled', 'processing', 'paused')
     and new.timezone is null then
    raise exception using
      errcode = '23514',
      message = 'campaign_timezone_required';
  end if;

  return new;
end;
$function$;

revoke all on function private.validate_whatsapp_campaign_timezone_v1()
  from public, anon, authenticated;

drop trigger if exists validate_whatsapp_campaign_timezone_v1
  on public.whatsapp_campaigns;
create trigger validate_whatsapp_campaign_timezone_v1
before insert or update of timezone, status
on public.whatsapp_campaigns
for each row
execute function private.validate_whatsapp_campaign_timezone_v1();

-- Defense in depth for rows written with triggers disabled during maintenance.
alter table public.whatsapp_campaigns
  drop constraint if exists whatsapp_campaigns_operational_timezone_check;
alter table public.whatsapp_campaigns
  add constraint whatsapp_campaigns_operational_timezone_check
  check (
    timezone is not null
    or status in ('review_required', 'completed', 'cancelled', 'failed')
  ) not valid;

alter table public.whatsapp_campaigns
  validate constraint whatsapp_campaigns_operational_timezone_check;
