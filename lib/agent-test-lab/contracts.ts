/** Public, secret-free contracts for the owner-operated laboratory. */
export const LAB_MODES = ["internal", "scenarios_10000", "scenarios_million", "mutation", "simulation", "manual", "scripted", "autonomous", "correction"] as const;
export type LabMode = typeof LAB_MODES[number];
export const LAB_REAL_MODES = new Set<LabMode>(["manual", "scripted", "autonomous", "correction"]);
export type LabVerdict = "passed" | "failed" | "expected_block" | "inconclusive" | "not_executed";
export type LabStatus = "queued" | "running" | "paused" | "waiting_reply" | "waiting_input" | "stopping" | "completed" | "failed" | "cancelled";
export type LabMediaKind = "text" | "audio" | "image" | "video" | "document";
export const LAB_PROFILES = {
  short: { maxMessages: 6, maxMinutes: 20, budgetBrl: 5 },
  complete: { maxMessages: 20, maxMinutes: 60, budgetBrl: 20 },
} as const;
export const LAB_MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const LAB_COOKIE = "mychatcrm_agent_lab_session";
export const LAB_SESSION_SECONDS = 2 * 60 * 60;
/** How long a tester waits for the agent before silence becomes a result.
 *  Generous on purpose: Evolution can hold a burst for around a minute, and the
 *  agent's own smart-wait adds to that. A slow turn is not a failed turn. */
export const LAB_AGENT_TURN_MAX_WAIT_SECONDS = 240;
/** Quiet period after the agent's last message that marks the turn as finished,
 *  so a burst is read as one answer instead of several. */
export const LAB_AGENT_TURN_QUIET_SECONDS = 25;
export const LAB_TICK_INTERVAL_SECONDS = 15;
/** Reserved before each tester message; settled with the real figure afterwards. */
export const LAB_MESSAGE_RESERVE_BRL = 0.05;
/** A lead does not send essays. Anything longer is truncated before it is sent. */
export const LAB_TESTER_MAX_MESSAGE_CHARS = 600;
export const LAB_MODE_LABELS: Record<LabMode, string> = {
  internal: "Testes internos", scenarios_10000: "10 mil cenários", scenarios_million: "1 milhão de cenários",
  mutation: "Mutation testing", simulation: "Simulação com IA", manual: "Conversa manual real",
  scripted: "Roteiro real", autonomous: "IA como lead real", correction: "Validar uma correção",
};
export type LabLimits = { maxMessages: number; maxMinutes: number; budgetBrl: number };
export type LabStepV1 = {
  kind: LabMediaKind | "wait"; text?: string; assetId?: string; waitSeconds?: number;
  expected: { type: "reply" | "silence" | "agenda_created" | "agenda_cancelled" | "follow_up" | "reminder" | "media_understood"; facts?: string[] };
};
export type LabScenarioV1 = { version: 1; name: string; goal: string; language: string; steps: LabStepV1[] };
export type LabRunRequestV1 = {
  mode: LabMode; profile: "short" | "complete" | "custom"; limits: LabLimits;
  targetKind: "copy" | "original"; tenantId: string; agentId: string; ruleId: string | null;
  connectionId: string | null; channel: "evolution" | "meta_cloud"; formId: string | null;
  scenario: LabScenarioV1; testerModel: string | null; allowedEffects: string[];
  originalConfirmed: boolean; reuseTestContext: boolean;
};
export type LabCheck = { code: string; ok: boolean; detail: string };
export type LabEvidenceV1 = { version: 1; check: string; verdict: LabVerdict; description: string; resourceIds: string[] };

function obj(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_object");
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number, required = true): string {
  if (typeof value !== "string" || value.length > max || (required && !value.trim())) throw new Error("invalid_text");
  return value.trim();
}
export function parseLabLimits(profile: unknown, value: unknown): LabLimits {
  if (profile === "short" || profile === "complete") return { ...LAB_PROFILES[profile] };
  if (profile !== "custom") throw new Error("invalid_profile");
  const raw = obj(value);
  const maxMessages = Number(raw.maxMessages), maxMinutes = Number(raw.maxMinutes), budgetBrl = Number(raw.budgetBrl);
  if (!Number.isInteger(maxMessages) || maxMessages < 1 || maxMessages > 1000 ||
      !Number.isInteger(maxMinutes) || maxMinutes < 1 || maxMinutes > 1440 ||
      !Number.isFinite(budgetBrl) || budgetBrl <= 0 || budgetBrl > 1000) throw new Error("invalid_limits");
  return { maxMessages, maxMinutes, budgetBrl };
}
export function parseLabScenario(value: unknown): LabScenarioV1 {
  const raw = obj(value);
  if (raw.version !== 1 || !Array.isArray(raw.steps) || raw.steps.length > 1000) throw new Error("invalid_scenario");
  const language = text(raw.language, 80);
  try { if (Intl.getCanonicalLocales(language).length !== 1) throw new Error(); } catch { throw new Error("invalid_language"); }
  const steps = raw.steps.map((value): LabStepV1 => {
    const step = obj(value), expected = obj(step.expected);
    const kind = text(step.kind, 20) as LabStepV1["kind"];
    if (!["text", "audio", "image", "video", "document", "wait"].includes(kind)) throw new Error("invalid_step_kind");
    const type = text(expected.type, 30) as LabStepV1["expected"]["type"];
    if (!["reply", "silence", "agenda_created", "agenda_cancelled", "follow_up", "reminder", "media_understood"].includes(type)) throw new Error("invalid_expectation");
    const result: LabStepV1 = { kind, expected: { type } };
    if (step.text != null) { text(step.text, 10000, false); result.text = step.text as string; }
    if (kind === "text" && !result.text?.trim()) throw new Error("step_text_required");
    if (["audio", "image", "video", "document"].includes(kind)) result.assetId = text(step.assetId, 80);
    if (kind === "wait") {
      result.waitSeconds = Number(step.waitSeconds);
      if (!Number.isInteger(result.waitSeconds) || result.waitSeconds < 1 || result.waitSeconds > 86400) throw new Error("invalid_wait");
    }
    if (expected.facts != null) {
      if (!Array.isArray(expected.facts) || expected.facts.length > 20) throw new Error("invalid_facts");
      result.expected.facts = expected.facts.map(v => text(v, 500));
    }
    return result;
  });
  return { version: 1, name: text(raw.name, 150), goal: text(raw.goal, 5000), language, steps };
}
export function parseLabRunRequest(value: unknown): LabRunRequestV1 {
  const raw = obj(value), mode = text(raw.mode, 30) as LabMode;
  if (!LAB_MODES.includes(mode)) throw new Error("invalid_mode");
  const limits = parseLabLimits(raw.profile, raw.limits);
  if (raw.targetKind !== "copy" && raw.targetKind !== "original") throw new Error("invalid_target_kind");
  if (raw.channel !== "evolution" && raw.channel !== "meta_cloud") throw new Error("invalid_channel");
  const optional = (key: string) => raw[key] == null || raw[key] === "" ? null : text(raw[key], 150);
  const testerModel = optional("testerModel");
  if (["simulation", "autonomous"].includes(mode) && !testerModel) throw new Error("tester_model_required");
  if (LAB_REAL_MODES.has(mode) && raw.targetKind === "original" && raw.originalConfirmed !== true) throw new Error("original_confirmation_required");
  const effects = Array.isArray(raw.allowedEffects) ? raw.allowedEffects.map(v => text(v, 30)) : [];
  if (effects.some(v => !["lead", "crm", "agenda", "follow_up", "reminder", "notifications", "external_api"].includes(v))) throw new Error("invalid_effect");
  return { mode, profile: raw.profile as LabRunRequestV1["profile"], limits, targetKind: raw.targetKind,
    tenantId: text(raw.tenantId ?? "internal", 150), agentId: text(raw.agentId ?? "internal", 150),
    ruleId: optional("ruleId"), connectionId: optional("connectionId"), channel: raw.channel, formId: optional("formId"),
    scenario: parseLabScenario(raw.scenario), testerModel, allowedEffects: effects,
    originalConfirmed: raw.originalConfirmed === true, reuseTestContext: raw.reuseTestContext === true };
}
