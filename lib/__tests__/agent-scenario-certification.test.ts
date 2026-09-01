import { describe, expect, it } from "vitest";
import { setImmediate as yieldToWorker } from "node:timers/promises";

import {
  normalizeAgentAgendaDate,
  normalizeAgentAgendaTime,
  parseAgentTurnPlan,
} from "@/lib/ai/agent-turn-plan";
import { normalizeIanaTimezone } from "@/lib/agents/agent-datetime";
import { normalizeConversationBurst } from "@/lib/conversas/normalize-conversation-burst";
import { evolutionWebhookEventKey } from "@/lib/server/evolution-webhook-inbox";
import { evaluateFollowUpNeed, type FollowUpEvalContext } from "@/lib/server/follow-up-engine";
import { DEFAULT_FOLLOW_UP_INTELIGENTE } from "@/lib/server/follow-up-settings";

const DEFAULT_CI_SCENARIOS = 10_000;
const MAX_SCENARIOS = 1_000_000;
const SEED = 0x4d594348;

function scenarioCount(): number {
  const parsed = Number.parseInt(process.env.AGENT_CERTIFICATION_SCENARIOS ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_CI_SCENARIOS;
  return Math.min(parsed, MAX_SCENARIOS);
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function supportedTimezones(): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: "timeZone") => string[] };
  const zones = intl.supportedValuesOf?.("timeZone") ?? [];
  return zones.includes("UTC") ? zones : ["UTC", ...zones];
}

function followUpContext(index: number, timezone: string): FollowUpEvalContext {
  const now = new Date(Date.UTC(2025 + (index % 5), index % 12, 1 + (index % 27), index % 24));
  const createdAt = new Date(now.getTime() - 7_200_000);
  const disabled = (index & 1) !== 0;
  const humanPaused = (index & 2) !== 0;
  const humanMode = (index & 4) !== 0;
  const replied = (index & 8) !== 0;
  const terminal = (index & 16) !== 0;
  return {
    now,
    settings: {
      ...DEFAULT_FOLLOW_UP_INTELIGENTE,
      ativo: !disabled,
      timezone,
      usarHorarioComercial: false,
      respeitarHumanoAtivo: true,
      bloquearSeLeadRespondeu: true,
      bloquearStatusPerdido: true,
    },
    job: { id: `job-${index}`, attempts: index % 3, maxAttempts: 3, createdAt },
    lead: {
      id: `lead-${index}`, name: null, status: terminal ? "perdido" : "active",
      lastMessageAt: null, lastFollowUpAt: null, followUpCount: 0,
      followUpCooldownUntil: null,
    },
    conversationState: {
      humanPaused, pausedReason: humanPaused ? "manual" : null,
      handoffSuggested: false, conversationMode: humanMode ? "human" : "automation",
      archivedAt: null,
    },
    lastCustomerMessageAt: replied ? new Date(createdAt.getTime() + 60_000) : null,
    lastAgentMessageAt: new Date(createdAt.getTime() + 30_000),
    lastHumanOutboundAt: null,
    hasFutureTask: false,
  };
}

describe("deterministic multi-tenant agent certification", () => {
  it("covers the configured scenario volume with production boundaries", async () => {
    const count = scenarioCount();
    const random = seededRandom(SEED);
    const zones = supportedTimezones();
    const eventKeys = new Set<string>();
    const failures: Array<{ index: number; invariant: string }> = [];

    for (let index = 0; index < count; index += 1) {
      // The million-scenario run is intentionally CPU-heavy. Yield often enough
      // for Vitest's worker RPC heartbeat so a successful long test is not
      // reported as a false timeout after 60 seconds.
      if (index > 0 && index % 10_000 === 0) await yieldToWorker();

      const tenantId = `cert-tenant-${index}`;
      const channel = index % 2 === 0 ? "evolution" : "meta_cloud";
      const timezone = zones[Math.floor(random() * zones.length)] ?? "UTC";
      if (normalizeIanaTimezone(timezone) !== timezone) {
        failures.push({ index, invariant: "iana_timezone" });
      }

      const payload = {
        event: "messages.upsert",
        instance: `${channel}-${index % 100}`,
        tenantId,
        data: { key: { id: `provider-${index}`, remoteJid: `contact-${index}@s.whatsapp.net` } },
      };
      const key = evolutionWebhookEventKey(payload);
      const reorderedKey = evolutionWebhookEventKey({
        data: payload.data, tenantId, instance: payload.instance, event: payload.event,
      });
      if (key !== reorderedKey || eventKeys.has(key)) {
        failures.push({ index, invariant: "provider_idempotency_or_isolation" });
      }
      eventKeys.add(key);

      const validAgenda = index % 4 !== 0;
      const day = 1 + (index % 27);
      const month = 1 + (index % 12);
      const year = 2026 + (index % 7);
      const date = validAgenda
        ? `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`
        : index % 8 === 0 ? "31/02/2026" : "invalid";
      const time = validAgenda
        ? `${String(index % 24).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}`
        : "24:00";
      const plan = parseAgentTurnPlan({
        reply: `reply-${index}`,
        agenda: { action: "create", date, time, location: null, eventId: null },
        handoff: { requested: false, reason: null }, media: { filenames: [] },
        leadOutcome: { action: "none", reason: null, evidence: null }, externalApiLookups: [],
      });
      if (!plan || (validAgenda
        ? plan.agenda.date !== date || plan.agenda.time !== time
        : normalizeAgentAgendaDate(date) !== null
          || normalizeAgentAgendaTime(time) !== null
          || plan.agenda.date !== null
          || plan.agenda.time !== null)) {
        failures.push({ index, invariant: "agenda_validation" });
      }

      const duplicate = index % 3 === 0;
      const burst = normalizeConversationBurst([
        { id: `${index}-a`, content: duplicate ? `Message ${index}` : "esta" },
        { id: `${index}-b`, content: duplicate ? ` MESSAGE   ${index} ` : "está" },
      ]);
      if (burst.replyUnits.length !== 1
        || burst.responseStrategy !== "single_natural"
        || (duplicate ? burst.canonicalMessages.length !== 1 : burst.canonicalMessages.length !== 2)) {
        failures.push({ index, invariant: "single_response_burst" });
      }

      const context = followUpContext(index, timezone);
      const decision = evaluateFollowUpNeed(context);
      const disabled = !context.settings.ativo;
      const human = context.conversationState?.humanPaused
        || context.conversationState?.conversationMode === "human";
      if ((disabled || human) && decision.shouldSend) {
        failures.push({ index, invariant: "disabled_or_takeover_follow_up" });
      }
      if (failures.length >= 100) break;
    }

    console.info("[agent-scenario-certification]", JSON.stringify({
      seed: SEED, scenarios: count, uniqueEventKeys: eventKeys.size,
      timezones: zones.length, failures: failures.length,
    }));
    expect(eventKeys.size).toBe(count);
    expect(failures).toEqual([]);
  }, 15 * 60_000);
});
