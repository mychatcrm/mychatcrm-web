import "server-only";
import { createHash } from "node:crypto";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { LAB_REAL_MODES, type LabRunRequestV1, type LabCheck } from "@/lib/agent-test-lab/contracts";
import { LAB_OWNER_ID, labOnlyExpectsSilence, labPhoneJid, labRuleMatches, isLabInternalMode } from "@/lib/agent-test-lab/policy";

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,stable(v)]));
  return value;
}
export const labFingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
export async function inspectLabTarget(input: LabRunRequestV1) {
  const sb = createSupabaseServiceClient(), checks: LabCheck[] = [];
  const check = (code: string, ok: boolean, detail: string) => checks.push({ code, ok, detail });
  const sha = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.AGENT_TEST_LAB_DEPLOY_SHA ?? "";
  check("deployment_known", /^[a-f0-9]{40}$/.test(sha), "A versão publicada precisa ser identificada.");
  if (isLabInternalMode(input.mode)) {
    check("github_configured", Boolean(process.env.AGENT_TEST_LAB_GITHUB_TOKEN), "Runner do GitHub configurado com acesso restrito.");
    return { checks, sha, configHash: labFingerprint({ mode: input.mode }), scenarioHash: labFingerprint(input.scenario), targetJid: null, agent: null };
  }
  const { data: agent, error } = await sb.from("tenant_agents").select("tenant_id,agent_id,display_name,system_prompt,model,metadata,active,review_reasons,archived_at,config_version")
    .eq("tenant_id", input.tenantId).eq("agent_id", input.agentId).maybeSingle();
  if (error) throw new Error("target_read_failed");
  check("agent_active", Boolean(agent?.active && !agent.archived_at), "O agente precisa existir e estar ativo.");
  if (!agent) return { checks, sha, configHash: "", scenarioHash: labFingerprint(input.scenario), targetJid: null, agent: null };
  let targetJid: string | null = null;
  if (LAB_REAL_MODES.has(input.mode)) {
    const table = input.channel === "evolution" ? "tenant_evolution_instances" : "whatsapp_cloud_connections";
    const selected = input.channel === "evolution" ? "id,wa_jid,connection_state" : "id,display_phone,active";
    const connection = await sb.from(table).select(selected).eq("tenant_id", input.tenantId).eq("id", input.connectionId ?? "00000000-0000-0000-0000-000000000000").maybeSingle();
    if (connection.error) throw new Error("connection_read_failed");
    const row = connection.data as unknown as Record<string, unknown> | null;
    targetJid = labPhoneJid(row?.wa_jid ?? row?.display_phone);
    check("connection_exact", Boolean(row && targetJid && (input.channel === "evolution" ? row.connection_state === "open" : row.active === true)), "Conexão ativa e número exatos pertencentes ao tenant.");
    const { data: rule, error: ruleError } = await sb.from("lead_distribution_rules")
      .select("id,active,source,agent_ids,connection_id,transport,included_form_ids,excluded_form_ids,use_all_forms,page_id")
      .eq("tenant_id", input.tenantId).eq("id", input.ruleId ?? "00000000-0000-0000-0000-000000000000").maybeSingle();
    if (ruleError) throw new Error("rule_read_failed");
    const intentionalSilence = labOnlyExpectsSilence(input);
    check("rule_exact", intentionalSilence || labRuleMatches(input, rule),
      intentionalSilence ? "Sem regra: somente silêncio é esperado." : "O teste não pode forçar uma regra ou agente diferente.");
    check("effects_confirmed", input.targetKind === "copy" || input.originalConfirmed, "Efeitos reais precisam ser confirmados nesta execução.");
    const sender = await sb.from("agent_test_lab_connections").select("id,state,wa_jid").eq("owner_admin_id", LAB_OWNER_ID).eq("purpose", "sender").is("archived_at", null).maybeSingle();
    if (sender.error) throw new Error("sender_read_failed");
    check("sender_connected", sender.data?.state === "open" && Boolean(sender.data?.wa_jid), "Escaneie o WhatsApp dedicado de teste.");
    check("different_numbers", Boolean(targetJid && labPhoneJid(sender.data?.wa_jid) && targetJid !== labPhoneJid(sender.data?.wa_jid)), "Testador e agente precisam de números diferentes.");
  }
  return { checks, sha, configHash: labFingerprint(agent), scenarioHash: labFingerprint(input.scenario), targetJid, agent };
}
