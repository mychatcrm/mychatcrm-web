import type { PendingAgendaActionRow } from "@/lib/server/agent-cta-scheduler";
import type { ConversationMessageContext } from "@/lib/server/conversation-memory";

/** Private persisted state, never accepted from a browser's run request. */
export function parseLabSimulationState(value: unknown): { nextOrdinal: number; pendingAction: PendingAgendaActionRow | null } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("simulation_state_invalid");
  const raw = value as Record<string, unknown>;
  const nextOrdinal = raw.nextOrdinal ?? 0;
  if (!Number.isInteger(nextOrdinal) || Number(nextOrdinal) < 0 || Number(nextOrdinal) > 1000) throw new Error("simulation_state_invalid");
  if (raw.pendingAction == null) return { nextOrdinal: Number(nextOrdinal), pendingAction: null };
  if (typeof raw.pendingAction !== "object" || Array.isArray(raw.pendingAction)) throw new Error("simulation_state_invalid");
  const p = raw.pendingAction as Record<string, unknown>;
  const text = (key: string, max: number, nullable = true): string | null => {
    const v = p[key];
    if (v === null && nullable) return null;
    if (typeof v !== "string" || v.length > max || (!nullable && !v)) throw new Error("simulation_state_invalid");
    return v;
  };
  if (!["create", "reschedule", "cancel"].includes(String(p.action))) throw new Error("simulation_state_invalid");
  const timezone = text("timezone", 100, false)!;
  try { new Intl.DateTimeFormat("en", { timeZone: timezone }).format(0); } catch { throw new Error("simulation_state_invalid"); }
  const expires = text("expires_at", 50, false)!;
  if (!/^\d{4}-\d\d-\d\dT/.test(expires) || !Number.isFinite(Date.parse(expires))) throw new Error("simulation_state_invalid");
  if (p.conversation_sequence !== null && (!Number.isSafeInteger(p.conversation_sequence) || Number(p.conversation_sequence) < 0)) throw new Error("simulation_state_invalid");
  return { nextOrdinal: Number(nextOrdinal), pendingAction: {
    id: text("id", 100, false)!, journey_id: text("journey_id", 100),
    action: p.action as PendingAgendaActionRow["action"], event_id: text("event_id", 100),
    proposed_date: text("proposed_date", 20), proposed_time: text("proposed_time", 20),
    proposed_location: text("proposed_location", 2000), timezone, expires_at: expires,
    conversation_sequence: p.conversation_sequence as number | null,
  } };
}

/** Only completed simulated turns of this run; provider/history IDs are rejected. */
export function labSimulationHistory(rows: Record<string, unknown>[], nextOrdinal: number): ConversationMessageContext[] {
  const messages = rows.map(row => {
    const match = /^sim:(\d+):(tester|agent)$/.exec(String(row.provider_message_id));
    if (!match || Number(match[1]) >= nextOrdinal || row.direction !== match[2]
      || typeof row.content !== "string" || row.content.length > 20000 || !Number.isFinite(Date.parse(String(row.provider_occurred_at)))) {
      throw new Error("simulation_history_invalid");
    }
    return { ordinal: Number(match[1]), side: match[2] === "tester" ? 0 : 1, row };
  }).sort((a, b) => a.ordinal - b.ordinal || a.side - b.side);
  const seen = new Set<string>();
  for (const message of messages) {
    const key = `${message.ordinal}:${message.side}`;
    if (seen.has(key)) throw new Error("simulation_history_invalid");
    seen.add(key);
  }
  return messages.slice(-20).map(({ row, side }) => ({
    role: side === 0 ? "user" : "assistant", content: row.content as string,
    kind: "text", createdAt: String(row.provider_occurred_at),
  }));
}
