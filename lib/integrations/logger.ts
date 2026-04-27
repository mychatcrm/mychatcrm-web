/**
 * Logs técnicos para integrações — nunca incluir tokens, corpos completos ou PII.
 */

export type IntegrationLogLevel = "debug" | "info" | "warn" | "error";

const REDACT = /(sk-[a-zA-Z0-9_-]{8,}|api[_-]?key|authorization|bearer\s+)[^\s"']*/gi;

function scrub(message: string): string {
  return message.replace(REDACT, "[redacted]");
}

export function integrationLog(
  scope: string,
  level: IntegrationLogLevel,
  message: string,
  meta?: Record<string, string | number | boolean | undefined>,
): void {
  const safeMsg = scrub(message);
  const safeMeta = meta
    ? Object.fromEntries(
        Object.entries(meta).map(([k, v]) => [k, typeof v === "string" ? scrub(v) : v]),
      )
    : undefined;
  const line = `[integrations:${scope}] ${safeMsg}`;
  if (level === "error") {
    console.error(line, safeMeta ?? "");
  } else if (level === "warn") {
    console.warn(line, safeMeta ?? "");
  } else {
    console.log(line, safeMeta ?? "");
  }
}
