import "server-only";
import { createHash } from "node:crypto";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { LAB_REAL_MODES, type LabRunRequestV1, type LabCheck } from "@/lib/agent-test-lab/contracts";
import { LAB_OWNER_ID, labOnlyExpectsSilence, labPhoneJid, labRuleMatches, isLabInternalMode } from "@/lib/agent-test-lab/policy";
import { inspectLabIsolatedAgent } from "./isolation";
import { hasApprovedLabCI } from "./github";
import { labSafetyChecks } from "@/lib/agent-test-lab/safety-policy";

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,stable(v)]));
  return value;
}
export const labFingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
export async function inspectLabTarget(input: LabRunRequestV1) {
  const sb = createSupabaseServiceClient(), checks: LabCheck[] = labSafetyChecks(input);
  const check = (code: string, ok: boolean, detail: string) => checks.push({ code, ok, detail });
  const sha = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.AGENT_TEST_LAB_DEPLOY_SHA ?? "";
  check("deployment_known", /^[a-f0-9]{40}$/.test(sha), "A versão publicada precisa ser identificada.");
  let senderJid: string | null = null, senderConnectionId: string | null = null;
  const effective = { tenantId: input.tenantId, agentId: input.agentId, connectionId: input.connectionId, ruleId: input.ruleId };
  let isolated: Awaited<ReturnType<typeof inspectLabIsolatedAgent>> = null;
  if (isLabInternalMode(input.mode)) {
    check("github_configured", Boolean(process.env.AGENT_TEST_LAB_GITHUB_TOKEN), "Runner do GitHub configurado com acesso restrito.");
    return { checks, sha, configHash: labFingerprint({ mode: input.mode }), scenarioHash: labFingerprint(input.scenario),
      targetJid: null, senderJid, senderConnectionId, agent: null, effective, isolatedAgentId: null };
  }
  // "Isolated copy" must aim at the copy, not at the customer's agent. Resolving the
  // effective target here means every check below — connection, rule, numbers — is
  // made against the thing that will actually receive the message.
  if (input.targetKind === "copy" && (LAB_REAL_MODES.has(input.mode) || input.mode === "simulation")) {
    isolated = await inspectLabIsolatedAgent(input.tenantId, input.agentId);
    check("isolated_copy_ready", Boolean(isolated), "Conecte o número que a cópia isolada atende antes de testá-la.");
    check("isolated_copy_current", !isolated?.stale, "A configuração de origem mudou. Reconecte a cópia para testar a versão atual.");
    if (isolated) {
      Object.assign(effective, { tenantId: isolated.labTenantId, agentId: isolated.labAgentId, connectionId: null, ruleId: null });
      if (LAB_REAL_MODES.has(input.mode)) {
      const routed = await sb.from("tenant_evolution_instances").select("id").eq("tenant_id", isolated.labTenantId).maybeSingle();
      if (routed.error) throw new Error("isolated_routing_read_failed");
      const rule = await sb.from("lead_distribution_rules").select("id")
        .eq("tenant_id", isolated.labTenantId).eq("source", "whatsapp_organico").eq("active", true).maybeSingle();
      if (rule.error) throw new Error("isolated_rule_read_failed");
      check("isolated_copy_routed", Boolean(routed.data && rule.data), "A cópia isolada ainda não tem conexão e regra próprias.");
      Object.assign(effective, {
        tenantId: isolated.labTenantId, agentId: isolated.labAgentId,
        connectionId: routed.data?.id ? String(routed.data.id) : null,
        ruleId: rule.data?.id ? String(rule.data.id) : null,
      });
      for (const dependency of isolated.unavailable) {
        check(`dependency_${dependency.dependency}`, false, dependency.reason);
      }
      }
    }
  }

  const { data: agent, error } = await sb.from("tenant_agents").select("tenant_id,agent_id,display_name,system_prompt,model,metadata,active,review_reasons,archived_at,config_version")
    .eq("tenant_id", effective.tenantId).eq("agent_id", effective.agentId).maybeSingle();
  if (error) throw new Error("target_read_failed");
  check("agent_active", Boolean(agent?.active && !agent.archived_at), "O agente precisa existir e estar ativo.");
  if (!agent) return { checks, sha, configHash: "", scenarioHash: labFingerprint(input.scenario),
    targetJid: null, senderJid, senderConnectionId, agent: null, effective, isolatedAgentId: isolated?.id ?? null };
  let targetJid: string | null = null;
  if (LAB_REAL_MODES.has(input.mode)) {
    const table = input.channel === "evolution" ? "tenant_evolution_instances" : "whatsapp_cloud_connections";
    const selected = input.channel === "evolution" ? "id,wa_jid,connection_state" : "id,display_phone,active";
    const connection = await sb.from(table).select(selected).eq("tenant_id", effective.tenantId).eq("id", effective.connectionId ?? "00000000-0000-0000-0000-000000000000").maybeSingle();
    if (connection.error) throw new Error("connection_read_failed");
    const row = connection.data as unknown as Record<string, unknown> | null;
    targetJid = labPhoneJid(row?.wa_jid ?? row?.display_phone);
    check("connection_exact", Boolean(row && targetJid && (input.channel === "evolution" ? row.connection_state === "open" : row.active === true)), "Conexão ativa e número exatos pertencentes ao tenant.");
    const { data: rule, error: ruleError } = await sb.from("lead_distribution_rules")
      .select("id,active,source,agent_ids,connection_id,transport,included_form_ids,excluded_form_ids,use_all_forms,page_id")
      .eq("tenant_id", effective.tenantId).eq("id", effective.ruleId ?? "00000000-0000-0000-0000-000000000000").maybeSingle();
    if (ruleError) throw new Error("rule_read_failed");
    const intentionalSilence = labOnlyExpectsSilence(input);
    check("rule_exact", intentionalSilence || labRuleMatches({ ...input, ...effective }, rule),
      intentionalSilence ? "Sem regra: somente silêncio é esperado." : "O teste não pode forçar uma regra ou agente diferente.");
    check("effects_confirmed", input.targetKind === "copy" || input.originalConfirmed, "Efeitos reais precisam ser confirmados nesta execução.");
    // The plan requires the internal suites to have passed on this exact commit
    // before a real conversation is allowed. Without the runner credential we
    // cannot know, and "cannot know" is not "approved".
    const ciApproved = await hasApprovedLabCI(sha).catch(() => false);
    check("internal_tests_approved", ciApproved, "A suíte interna precisa estar aprovada nesta versão publicada antes de um teste real.");
    const sender = await sb.from("agent_test_lab_connections").select("id,state,wa_jid").eq("owner_admin_id", LAB_OWNER_ID).eq("purpose", "sender").is("archived_at", null).maybeSingle();
    if (sender.error) throw new Error("sender_read_failed");
    senderJid = labPhoneJid(sender.data?.wa_jid);
    senderConnectionId = sender.data?.id ? String(sender.data.id) : null;
    check("sender_connected", sender.data?.state === "open" && Boolean(senderJid) && Boolean(senderConnectionId), "Escaneie o WhatsApp dedicado de teste.");
    check("different_numbers", Boolean(targetJid && senderJid && targetJid !== senderJid), "Testador e agente precisam de números diferentes.");
    if (senderJid) {
      const history = await sb.from("whatsapp_messages").select("id", { count: "exact", head: true })
        .eq("tenant_id", effective.tenantId).eq("remote_jid", senderJid);
      const journeys = await sb.from("lead_journeys").select("id", { count: "exact", head: true })
        .eq("tenant_id", effective.tenantId).eq("remote_jid", senderJid);
      if (history.error || journeys.error) throw new Error("test_context_read_failed");
      check("test_contact_fresh", history.count === 0 && journeys.count === 0,
        "Este contato já possui histórico. Use outro contato controlado até a reutilização isolada ser validada.");
    }
  }
  return { checks, sha, configHash: labFingerprint(agent), scenarioHash: labFingerprint(input.scenario),
    targetJid, senderJid, senderConnectionId, agent, effective, isolatedAgentId: isolated?.id ?? null };
}
