import type { LabRunRequestV1 } from "./contracts";

export const LAB_OWNER_ID = "admin-renato-lagares";
export const LAB_INSTANCE_PREFIX = "mychatcrm-lab-sender-";
export const LAB_INTERNAL_MODES = ["internal", "scenarios_10000", "scenarios_million", "mutation"] as const;
export function isLabInternalMode(mode: string): boolean {
  return (LAB_INTERNAL_MODES as readonly string[]).includes(mode);
}
export function assertLabUuid(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new Error("invalid_identifier");
  return value;
}
/** Only provider-confirmed telephone identities; never derive a phone from a LID. */
export function labPhoneJid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.includes("@")) return /^[1-9][0-9]{6,14}@s\.whatsapp\.net$/.test(value) ? value : null;
  if (!/^\+?[0-9 ()-]+$/.test(value)) return null;
  const digits = value.replace(/[^0-9]/g, "");
  return /^[1-9][0-9]{6,14}$/.test(digits) ? `${digits}@s.whatsapp.net` : null;
}
export function labRuleMatches(input: LabRunRequestV1, rule: Record<string, unknown> | null): boolean {
  if (!rule || rule.active !== true || rule.connection_id !== input.connectionId ||
    rule.transport !== (input.channel === "evolution" ? "evolution" : "cloud_api") ||
    !Array.isArray(rule.agent_ids) || !rule.agent_ids.includes(input.agentId)) return false;
  if (!input.formId) return rule.source === "whatsapp_organico" && rule.agent_ids.length === 1;
  if (rule.source !== "meta_form") return false;
  const excluded = Array.isArray(rule.excluded_form_ids) ? rule.excluded_form_ids : [];
  const included = Array.isArray(rule.included_form_ids) ? rule.included_form_ids : [];
  return !excluded.includes(input.formId) && (rule.use_all_forms === true || included.includes(input.formId));
}
export function labOnlyExpectsSilence(input: LabRunRequestV1): boolean {
  return !input.ruleId && !input.formId && input.scenario.steps.length > 0 && input.scenario.steps.every(step => step.expected.type === "silence");
}
export function labReceiptDisposition(dispatched: boolean, confirmed: boolean): "send" | "confirmed" | "inconclusive" {
  return confirmed ? "confirmed" : dispatched ? "inconclusive" : "send";
}
export function labMaskedJid(value: string | null): string | null {
  if (!value) return null;
  const digits = value.split("@")[0];
  return `${digits.slice(0, 2)}••••${digits.slice(-3)}`;
}
