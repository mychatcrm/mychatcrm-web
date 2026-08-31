#!/usr/bin/env node

import { pathToFileURL } from "node:url";

const DEFAULT_HEALTH_URL = "https://www.mychatcrm.com.br/api/internal/agent-runtime-health";
const WORKFLOW_FILE = "agent-runtime-watchdog.yml";
const HOUR_MS = 60 * 60 * 1000;

function clean(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function boundedCodes(value) {
  if (!Array.isArray(value)) return ["health_endpoint_unreachable"];
  const codes = value
    .filter((item) => typeof item === "string" && /^[a-z0-9_:-]{1,80}$/i.test(item))
    .slice(0, 10);
  return codes.length ? codes : ["runtime_unhealthy"];
}

export function decideWatchdogNotification({ healthy, now, previousRuns }) {
  const previous = previousRuns[0] ?? null;
  const previousFailed = previous ? previous.conclusion !== "success" : false;

  if (healthy) {
    return previousFailed ? "recovery" : null;
  }
  if (!previous || !previousFailed) return "failure";

  const consecutiveFailures = [];
  for (const run of previousRuns) {
    if (run.conclusion === "success") break;
    consecutiveFailures.push(run);
  }
  const incidentStart = consecutiveFailures.at(-1)?.created_at ?? previous.created_at;
  const incidentAt = Date.parse(incidentStart);
  const previousAt = Date.parse(previous.created_at);
  if (!Number.isFinite(incidentAt) || !Number.isFinite(previousAt)) return null;

  const currentBucket = Math.floor(Math.max(0, now - incidentAt) / HOUR_MS);
  const previousBucket = Math.floor(Math.max(0, previousAt - incidentAt) / HOUR_MS);
  return currentBucket > previousBucket ? "repeat" : null;
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function readHealth() {
  const url = clean(process.env.AGENT_RUNTIME_HEALTH_URL) ?? DEFAULT_HEALTH_URL;
  const secret = clean(process.env.AGENT_RUNTIME_WATCHDOG_SECRET);
  if (!secret) {
    return { healthy: false, reasons: ["watchdog_secret_missing"], httpStatus: null };
  }

  try {
    const response = await fetchWithTimeout(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${secret}`,
        Accept: "application/json",
        "User-Agent": "mychatcrm-agent-runtime-watchdog/1",
      },
    }, 15_000);
    const body = await response.json().catch(() => ({}));
    return {
      healthy: response.ok && body?.ok === true && body?.status === "healthy",
      reasons: boundedCodes(body?.reasons),
      httpStatus: response.status,
    };
  } catch {
    return { healthy: false, reasons: ["health_endpoint_unreachable"], httpStatus: null };
  }
}

async function previousWorkflowRuns() {
  const token = clean(process.env.GITHUB_TOKEN);
  const repository = clean(process.env.GITHUB_REPOSITORY);
  const currentRunId = clean(process.env.GITHUB_RUN_ID);
  if (!token || !repository) return [];

  const url = `https://api.github.com/repos/${repository}/actions/workflows/${WORKFLOW_FILE}/runs?status=completed&per_page=100`;
  try {
    const response = await fetchWithTimeout(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "mychatcrm-agent-runtime-watchdog/1",
      },
    }, 10_000);
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data?.workflow_runs)
      ? data.workflow_runs
        .filter((run) => String(run?.id ?? "") !== currentRunId)
        .filter((run) => typeof run?.created_at === "string" && typeof run?.conclusion === "string")
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      : [];
  } catch {
    return [];
  }
}

function notificationCopy(kind, reasons) {
  const reasonText = reasons.join(", ");
  const testPrefix = clean(process.env.AGENT_RUNTIME_WATCHDOG_MODE)?.startsWith("test_")
    ? "[TESTE SEGURO — NÃO É INCIDENTE REAL] "
    : "";
  if (kind === "recovery") {
    return {
      subject: `${testPrefix}MyChatCRM — runtime dos agentes normalizado`,
      text: `${testPrefix}O monitor externo confirmou a recuperação do runtime dos agentes.`,
    };
  }
  const prefix = kind === "repeat" ? "Falha ainda ativa" : "Falha crítica detectada";
  return {
    subject: `${testPrefix}MyChatCRM — ${prefix} no runtime dos agentes`,
    text: `${testPrefix}${prefix}. Códigos técnicos: ${reasonText}. Verifique filas, crons e provedores imediatamente.`,
  };
}

async function sendEmail(copy) {
  const apiKey = clean(process.env.AGENT_RUNTIME_RESEND_API_KEY);
  const from = clean(process.env.AGENT_RUNTIME_RESEND_FROM_EMAIL);
  const to = clean(process.env.AGENT_RUNTIME_ALERT_EMAIL);
  if (!apiKey || !from || !to) return { ok: false, code: "email_not_configured" };

  try {
    const response = await fetchWithTimeout("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: copy.subject,
        text: copy.text,
        html: `<p>${copy.text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</p>`,
      }),
    }, 10_000);
    return response.ok
      ? { ok: true, code: "email_sent" }
      : { ok: false, code: `email_http_${response.status}` };
  } catch {
    return { ok: false, code: "email_request_failed" };
  }
}

async function sendWhatsapp(copy) {
  const baseUrl = clean(process.env.AGENT_RUNTIME_EVOLUTION_API_BASE_URL)?.replace(/\/+$/, "");
  const apiKey = clean(process.env.AGENT_RUNTIME_EVOLUTION_API_KEY);
  const instance = clean(process.env.AGENT_RUNTIME_EVOLUTION_INSTANCE);
  const number = clean(process.env.AGENT_RUNTIME_ALERT_WHATSAPP);
  if (!baseUrl || !baseUrl.startsWith("https://") || !apiKey || !instance || !number) {
    return { ok: false, code: "whatsapp_not_configured" };
  }

  try {
    const response = await fetchWithTimeout(
      `${baseUrl}/message/sendText/${encodeURIComponent(instance)}`,
      {
        method: "POST",
        headers: {
          apikey: apiKey,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ number, text: copy.text.slice(0, 4000) }),
      },
      10_000,
    );
    return response.ok
      ? { ok: true, code: "whatsapp_sent" }
      : { ok: false, code: `whatsapp_http_${response.status}` };
  } catch {
    return { ok: false, code: "whatsapp_request_failed" };
  }
}

async function notify(kind, reasons) {
  const copy = notificationCopy(kind, reasons);
  const [email, whatsapp] = await Promise.all([sendEmail(copy), sendWhatsapp(copy)]);
  console.log(JSON.stringify({
    scope: "agent-runtime-watchdog",
    event: "notification_attempted",
    kind,
    email: email.code,
    whatsapp: whatsapp.code,
  }));
  return email.ok && whatsapp.ok;
}

async function reportExecution(payload) {
  const healthUrl = clean(process.env.AGENT_RUNTIME_HEALTH_URL) ?? DEFAULT_HEALTH_URL;
  const url = clean(process.env.AGENT_RUNTIME_AUDIT_URL)
    ?? new URL("/api/internal/agent-runtime-watchdog/report", healthUrl).toString();
  const secret = clean(process.env.AGENT_RUNTIME_WATCHDOG_SECRET);
  if (!secret) return { ok: false, code: "report_secret_missing" };
  try {
    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
        "User-Agent": "mychatcrm-agent-runtime-watchdog/1",
      },
      body: JSON.stringify(payload),
    }, 10_000);
    return response.ok ? { ok: true, code: "reported" } : { ok: false, code: `report_http_${response.status}` };
  } catch {
    return { ok: false, code: "report_request_failed" };
  }
}

export async function main() {
  const startedAt = Date.now();
  const mode = clean(process.env.AGENT_RUNTIME_WATCHDOG_MODE) ?? "live";
  const isTest = mode.startsWith("test_");
  if (!isTest) {
    const startReport = await reportExecution({
      mode, phase: "started", healthy: true, reasonCodes: ["watchdog_started"],
      durationMs: 0, runId: clean(process.env.GITHUB_RUN_ID),
      repository: clean(process.env.GITHUB_REPOSITORY),
      deploymentSha: clean(process.env.WATCHDOG_DEPLOYMENT_SHA),
    });
    if (!startReport.ok) {
      console.error(JSON.stringify({
        scope: "agent-runtime-watchdog", event: "start_report_failed", code: startReport.code,
      }));
    }
  }
  const [liveHealth, runs] = await Promise.all([readHealth(), previousWorkflowRuns()]);
  const health = isTest
    ? { healthy: mode === "test_recovery", reasons: [`watchdog_${mode}`], httpStatus: liveHealth.httpStatus }
    : liveHealth;
  const notification = mode === "test_failure" ? "failure"
    : mode === "test_repeat" ? "repeat"
      : mode === "test_recovery" ? "recovery"
        : decideWatchdogNotification({ healthy: health.healthy, now: Date.now(), previousRuns: runs });

  let notificationDelivered = true;
  if (notification) notificationDelivered = await notify(notification, health.reasons);

  const report = await reportExecution({
    mode, phase: "completed", healthy: health.healthy, httpStatus: health.httpStatus,
    reasonCodes: health.reasons, notification, notificationDelivered,
    durationMs: Date.now() - startedAt,
    runId: clean(process.env.GITHUB_RUN_ID),
    repository: clean(process.env.GITHUB_REPOSITORY),
    deploymentSha: clean(process.env.WATCHDOG_DEPLOYMENT_SHA),
  });

  console.log(JSON.stringify({
    scope: "agent-runtime-watchdog",
    event: "check_completed",
    healthy: health.healthy,
    httpStatus: health.httpStatus,
    reasonCodes: health.reasons,
    notification,
    notificationDelivered,
    report: report.code,
    mode,
    duration_ms: Date.now() - startedAt,
  }));

  if (!isTest && !health.healthy) process.exitCode = 1;
  if (!isTest && health.healthy && notification && !notificationDelivered) process.exitCode = 1;
  if (!report.ok || (isTest && !notificationDelivered)) process.exitCode = 1;
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (entrypoint === import.meta.url) {
  await main();
}
