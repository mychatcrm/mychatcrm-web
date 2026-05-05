/**
 * Lista server-side de pares tenant:agent permitidos no POST /api/chat (widget público).
 * Formato: "tenantId:agentId" separados por vírgula.
 * Se vazio, só "public:marketing_site_assistant".
 */
const DEFAULT_PAIR = "public:marketing_site_assistant";

function parseAllowlist(raw: string | undefined): Set<string> {
  const src = (raw?.trim() || DEFAULT_PAIR).split(",");
  const set = new Set<string>();
  for (const part of src) {
    const p = part.trim();
    if (!p.includes(":")) continue;
    const [t, ...rest] = p.split(":");
    const a = rest.join(":").trim();
    if (t.trim() && a) set.add(`${t.trim()}:${a}`);
  }
  if (set.size === 0) set.add(DEFAULT_PAIR);
  return set;
}

export function isChatWidgetTenantAgentAllowed(tenantId: string, agentId: string): boolean {
  const key = `${tenantId.trim()}:${agentId.trim()}`;
  return parseAllowlist(process.env.CHAT_WIDGET_TENANT_AGENT_ALLOWLIST).has(key);
}
