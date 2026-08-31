import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isAgentArchivedMetadata,
  resolveAgentContextSaveDecision,
  validateAgentManagementPayload,
} from "@/lib/server/agent-management-validation";
import type { Agent } from "@/lib/types";
import { describeAgentDependencyBlock } from "@/lib/server/agent-management-dependencies";

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? routeFiles(path) : entry.name === "route.ts" ? [path] : [];
  });
}

const validAgent = {
  id: "agent-universal-1",
  nome: "Agente Universal",
  status: "inativo",
  instructionMode: "pro",
  systemPrompt: "Siga as instruções do operador.",
  promptIdentidade: "",
  promptObjetivo: "",
  promptRegrasAdicionais: "",
  respostasProibidas: "",
  origens: [],
  fluxo: [],
  arquivosTreinamento: [],
  externalApiConnectorIds: [],
  ctaHandoffAtivo: false,
};

function supabaseStub(results: Record<string, { data: unknown[] | null; error: { message: string } | null }>) {
  return {
    from(table: string) {
      const result = results[table] ?? { data: [], error: null };
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "eq", "contains", "in", "limit"]) {
        chain[method] = () => chain;
      }
      chain.then = (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve);
      return chain;
    },
  };
}

describe("agent management hardening", () => {
  it("uses the active role guard in every agents API route", () => {
    const files = routeFiles(join(process.cwd(), "app/api/client/agentes"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source, file).toContain("requireAgentManagementSession");
      expect(source, file).not.toContain("getClientSessionFromCookies");
    }
  });

  it("rejects an ID mismatch and an invalid active handoff", () => {
    const mismatch = validateAgentManagementPayload(validAgent, {
      requireId: false,
      expectedId: "another-agent",
    });
    expect(mismatch).toEqual({ ok: false, error: "O ID do corpo não corresponde ao agente da rota." });

    const invalidHandoff = validateAgentManagementPayload({
      ...validAgent,
      ctaHandoffAtivo: true,
      handoffNumero: "123",
      handoffMensagem: "",
    });
    expect(invalidHandoff.ok).toBe(false);
  });

  it("requires a persisted version for updates", () => {
    const missing = validateAgentManagementPayload(validAgent, {
      requireId: true,
      expectedId: validAgent.id,
      requireVersion: true,
    });
    expect(missing).toEqual({
      ok: false,
      error: "Versão do agente inválida. Recarregue a página e tente novamente.",
    });
    const current = validateAgentManagementPayload(
      { ...validAgent, atualizadoEm: "2026-08-24T12:00:00.000Z" },
      { requireId: true, expectedId: validAgent.id, requireVersion: true },
    );
    expect(current.ok).toBe(true);
  });

  it("accepts a configured international handoff without assuming a country", () => {
    const result = validateAgentManagementPayload({
      ...validAgent,
      ctaHandoffAtivo: true,
      handoffNumero: "+1 415 555 2671",
      handoffMensagem: "I will transfer this conversation now.",
      handoffKeywords: ["human support"],
    });
    expect(result.ok).toBe(true);
  });

  it("marks only time-dependent resources for review without blocking the agent payload", () => {
    const agent = {
      ...validAgent,
      agendaAutomationEnabled: true,
      followUpInteligente: {
        ativo: true,
        usarHorarioComercial: true,
      },
      timezone: "",
    } as unknown as Agent;
    expect(validateAgentManagementPayload(agent).ok).toBe(true);
    const decision = resolveAgentContextSaveDecision({ agent });
    expect(decision.reviewReasons).toEqual(expect.arrayContaining([
      "agenda_timezone_required",
      "follow_up_timezone_required",
    ]));
  });

  it("preserves agents without time-dependent features and clears stale timezone review", () => {
    const agent = {
      ...validAgent,
      agendaAutomationEnabled: false,
      followUpInteligente: {
        ativo: true,
        usarHorarioComercial: false,
      },
      timezone: "",
    } as unknown as Agent;
    const decision = resolveAgentContextSaveDecision({
      agent,
      existingReviewReasons: [
        "agenda_timezone_required",
        "follow_up_timezone_required",
      ],
    });
    expect(decision.reviewReasons).not.toContain("agenda_timezone_required");
    expect(decision.reviewReasons).not.toContain("follow_up_timezone_required");
  });

  it("marks missing operator-authored agenda messages without inventing Portuguese copy", () => {
    const agent = {
      ...validAgent,
      agendaLembretes: {
        ativo: true,
        regras: [{ offsetValor: 1, offsetUnidade: "dias", mensagem: "" }],
      },
      agendaDisponibilidade: {
        ativo: true,
        diasSemana: [1, 2, 3, 4, 5],
        horaInicio: "08:00",
        horaFim: "18:00",
        mensagemForaJanela: "",
        permitirAgendamentosSimultaneos: true,
      },
    } as unknown as Agent;
    const decision = resolveAgentContextSaveDecision({ agent });
    expect(decision.reviewReasons).toEqual(expect.arrayContaining([
      "agenda_reminder_message_required",
      "agenda_outside_window_message_required",
    ]));

    const wizardModel = readFileSync(
      join(process.cwd(), "lib/agents/wizard-model.ts"),
      "utf8",
    );
    const agendaStep = readFileSync(
      join(process.cwd(), "components/dashboard/agentes/WizardStepAgendaAutomation.tsx"),
      "utf8",
    );
    expect(wizardModel).not.toContain("Olá {nome}, lembrete");
    expect(agendaStep).not.toContain("Esse horário fica fora da nossa janela");
  });

  it("validates updates with the model stored on the actual agent row", () => {
    const item = readFileSync(join(process.cwd(), "app/api/client/agentes/[id]/route.ts"), "utf8");
    expect(item).toContain('model: typeof existing.data.model === "string" ? existing.data.model : null');
  });

  it("recognizes soft-archived metadata", () => {
    expect(isAgentArchivedMetadata({ managementLifecycle: { archivedAt: "2026-08-24T12:00:00.000Z" } })).toBe(true);
    expect(isAgentArchivedMetadata({ managementLifecycle: {} })).toBe(false);
  });

  it("creates atomically and archives instead of hard deleting", () => {
    const collection = readFileSync(join(process.cwd(), "app/api/client/agentes/route.ts"), "utf8");
    const item = readFileSync(join(process.cwd(), "app/api/client/agentes/[id]/route.ts"), "utf8");
    const persistence = readFileSync(join(process.cwd(), "lib/server/agent-management-persistence.ts"), "utf8");
    expect(collection).toContain("saveTenantAgentAtomic");
    expect(persistence).toContain('rpc("save_tenant_agent_v2"');
    expect(item).toContain("archiveTenantAgentAtomic");
    expect(item).not.toContain('.from("tenant_agents")\n    .delete()');
    expect(item).toContain("describeAgentDependencyBlock");
    expect(item).toContain("AGENT_VERSION_CONFLICT");
  });

  it("keeps human control state and audit event writable by the server role", () => {
    const migration = readFileSync(
      join(process.cwd(), "supabase/migrations/20260824160856_agent_runtime_hardening_v2.sql"),
      "utf8",
    );
    expect(migration).toContain(
      "grant select, insert on table public.conversation_events to service_role",
    );
    expect(migration).toContain("create or replace function public.set_conversation_operation_v3");
    expect(migration).not.toMatch(
      /grant\s+(?:select|insert|update|delete|all)[^;]*conversation_events[^;]*to\s+(?:anon|authenticated)/i,
    );
  });

  it("fails closed when pausing an agent assigned to an active rule", async () => {
    const sb = supabaseStub({
      lead_distribution_rules: {
        data: [{ id: "rule-1", name: "Formulário principal", active: true }],
        error: null,
      },
    });
    const result = await describeAgentDependencyBlock({
      sb: sb as never,
      tenantId: "tenant-a",
      agentId: "agent-universal-1",
      kind: "pause",
    });
    expect(result?.code).toBe("AGENT_HAS_ACTIVE_RULES");
  });

  it("fails closed when dependency lookup is unavailable", async () => {
    const sb = supabaseStub({
      lead_distribution_rules: { data: null, error: { message: "permission denied" } },
    });
    const result = await describeAgentDependencyBlock({
      sb: sb as never,
      tenantId: "tenant-a",
      agentId: "agent-universal-1",
      kind: "archive",
    });
    expect(result?.code).toBe("AGENT_DEPENDENCY_CHECK_FAILED");
  });

  it("waits for persistence before closing overlays", () => {
    const overlay = readFileSync(join(process.cwd(), "components/dashboard/agentes/AgentCreateOverlay.tsx"), "utf8");
    const hub = readFileSync(join(process.cwd(), "components/dashboard/agentes/AgentsHub.tsx"), "utf8");
    const standalone = readFileSync(join(process.cwd(), "components/dashboard/agentes/AgentStandaloneEditor.tsx"), "utf8");
    expect(overlay).toContain("await onCreated");
    expect(overlay).toContain("await onUpdated");
    expect(overlay).toContain("await onDeleted");
    expect(hub).toContain("const saved = await apiCreateAgent");
    expect(hub).toContain("const saved = await apiUpdateAgent");
    expect(standalone).toContain('method: "PUT"');
  });
});
