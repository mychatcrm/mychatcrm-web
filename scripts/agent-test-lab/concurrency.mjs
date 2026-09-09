import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";

const exec = promisify(execFile);
// Intentionally no arbitrary production DSN. Use an empty, disposable local fixture DB.
const port = process.env.AGENT_LAB_TEST_PGPORT ?? "55439";
if (!/^\d{4,5}$/.test(port)) throw new Error("invalid_test_port");
const socket = process.env.AGENT_LAB_TEST_PGSOCKET;
if (socket && !socket.startsWith("/private/tmp/mychatcrm-lab-postgres-")) throw new Error("invalid_test_socket");
const database = process.env.AGENT_LAB_TEST_PGDATABASE ?? "postgres";
if (database !== "postgres" && !/^lab_check_[a-z0-9]+$/.test(database)) throw new Error("invalid_fixture_database");
const args = ["-h", socket ?? "127.0.0.1", "-p", port, "-d", database, "-v", "ON_ERROR_STOP=1", "-Atc"];
async function sql(statement) {
  const result = await exec("psql", [...args, statement], { timeout: 20000, maxBuffer: 1024 * 1024 });
  return result.stdout.trim();
}
// Refuse an ordinary MyChatCRM/Supabase DB even if someone forwards a production port.
if (await sql("select to_regclass('public.lab_test_audit_log') is not null and to_regclass('public.tenant_agents') is null") !== "t") throw new Error("not_a_disposable_fixture");
const runId = randomUUID(), senderId = randomUUID(), otherRunId = randomUUID();
const runInsert = id => `insert into public.agent_test_lab_runs(id,owner_admin_id,mode,status,deployed_sha,config_hash,scenario_hash,request,max_messages,budget_brl,deadline_at,sender_connection_id) values('${id}','admin-renato-lagares','internal','queued',repeat('a',40),'config','scenario','{}',100,5,now()+interval '10 minutes','${senderId}')`;
try {
  await sql(`insert into public.agent_test_lab_connections(id,owner_admin_id,purpose,instance_name,webhook_secret_hash) values('${senderId}','admin-renato-lagares','sender','fixture-${senderId}',repeat('a',64)); ${runInsert(runId)}; ${runInsert(otherRunId)}`);
  const claims = await Promise.all(Array.from({ length: 16 }, () => sql(`select public.claim_agent_test_lab_run_v1('${runId}') is not null`)));
  if (claims.filter(value => value === "t").length !== 1) throw new Error("concurrent_claim_collision");
  if (await sql(`select public.claim_agent_test_lab_run_v1('${otherRunId}') is null`) !== "t") throw new Error("sender_conversation_collision");
  const reservations = await Promise.all(Array.from({ length: 20 }, (_, i) => sql(`select public.reserve_agent_test_lab_cost_v1('${runId}','${runId}:${i}','tester_ai',1,true)->>'ok'`)));
  if (reservations.filter(value => value === "true").length !== 5) throw new Error("concurrent_budget_exceeded");
  const duplicate = await Promise.all(Array.from({ length: 16 }, () => sql(`select public.reserve_agent_test_lab_cost_v1('${runId}','${runId}:duplicate','transport',0,true)->>'ok'`)));
  if (duplicate.filter(value => value === "true").length !== 1) throw new Error("concurrent_idempotency_collision");
  await sql(`select public.control_agent_test_lab_run_v1('${runId}','admin-renato-lagares','pause')`);
  const paused = await Promise.all(Array.from({ length: 10 }, (_, i) => sql(`select public.reserve_agent_test_lab_cost_v1('${runId}','${runId}:paused:${i}','transport',0,true)->>'ok'`)));
  if (paused.some(value => value === "true")) throw new Error("paused_action_accepted");
  console.log(JSON.stringify({ passed: true, concurrentClaims: 16, budgetContenders: 20, duplicateContenders: 16, pausedAttempts: 10, sharedSenderRuns: 2 }));
} finally {
  // Exact random fixture IDs only. No production tenant/lead/event is touched.
  await sql(`delete from public.agent_test_lab_costs where run_id in ('${runId}','${otherRunId}'); delete from public.agent_test_lab_runs where id in ('${runId}','${otherRunId}'); delete from public.agent_test_lab_connections where id='${senderId}'; delete from public.lab_test_audit_log where run_id in ('${runId}','${otherRunId}')`);
}
