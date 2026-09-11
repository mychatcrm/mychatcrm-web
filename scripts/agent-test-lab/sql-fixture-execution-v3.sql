-- LOCAL DISPOSABLE DATABASE ONLY. Never apply fixtures to Supabase.
create table public.tenant_evolution_instances(id uuid primary key,tenant_id text,instance_name text,wa_jid text);
create table public.agent_outbound_outbox(id uuid primary key,tenant_id text,agent_id text,remote_jid text,
 rule_id uuid,connection_id text,channel text,journey_id uuid,authorization_status text,status text);
