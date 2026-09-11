-- LOCAL DISPOSABLE DATABASE ONLY. Stubs mirror the column types used by V2.
create table public.tenants(id text primary key);
create table public.lead_distribution_rules(id uuid primary key,tenant_id text,transport text);
create table public.lead_journeys(id uuid primary key,tenant_id text,remote_jid text,
 agent_id text,rule_id uuid,connection_id text,created_at timestamptz);
create table public.conversation_states(tenant_id text,remote_jid text,channel text,
 active_journey_id uuid,lead_id uuid,automation_epoch bigint,primary key(tenant_id,remote_jid,channel));
create table public.lab_stop_calls(tenant_id text,remote_jid text,epoch bigint);
create function public.set_conversation_operation_v3(
 p_tenant_id text,p_remote_jid text,p_lead_id uuid,p_agent_id text,p_mode text,p_human_paused boolean,
 p_paused_reason text,p_paused_by text,p_handoff_suggested boolean,p_handoff_reason text,
 p_assigned_human_id text,p_assigned_human_name text,p_transferred_from text,p_transferred_to text,
 p_transfer_reason text,p_expected_epoch bigint,p_event_type text,p_event_title text,p_event_detail text,
 p_actor_type text,p_actor_id text,p_actor_name text)
returns jsonb language plpgsql as $$ begin
 insert into public.lab_stop_calls values(p_tenant_id,p_remote_jid,p_expected_epoch);
 return '{"state":{}}'::jsonb;
end $$;
