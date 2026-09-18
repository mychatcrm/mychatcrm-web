import { describe, expect, it } from "vitest";
import { buildFingerprint, detectAlertsFromEvents } from "@/lib/server/meta-lead-alerts";

const NOW = new Date("2026-09-17T12:00:00Z");
const WINDOW_HOURS = 24;

function event(overrides: Partial<{
  campaign_id: string | null;
  campaign_name: string | null;
  form_id: string | null;
  form_name: string | null;
  current_step: string;
  crm_sync_status: string;
  hoursAgo: number;
}> = {}) {
  const hoursAgo = overrides.hoursAgo ?? 1;
  return {
    campaign_id: overrides.campaign_id ?? "camp-1",
    campaign_name: overrides.campaign_name ?? "Campanha A",
    form_id: overrides.form_id ?? "form-1",
    form_name: overrides.form_name ?? "Formulário A",
    current_step: overrides.current_step ?? "whatsapp_sent",
    crm_sync_status: overrides.crm_sync_status ?? "synced",
    created_at: new Date(NOW.getTime() - hoursAgo * 60 * 60 * 1000).toISOString(),
  };
}

/** Janela recente = últimas 24 h; anterior = as 24 h antes disso. */
function baseline(count: number, overrides = {}) {
  return Array.from({ length: count }, () => event({ ...overrides, hoursAgo: 30 }));
}

function recent(count: number, overrides = {}) {
  return Array.from({ length: count }, () => event({ ...overrides, hoursAgo: 2 }));
}

describe("detectAlertsFromEvents", () => {
  it("não inventa alerta quando o volume se mantém", () => {
    const alerts = detectAlertsFromEvents({
      events: [...baseline(20), ...recent(19)],
      now: NOW,
      windowHours: WINDOW_HOURS,
    });
    expect(alerts).toHaveLength(0);
  });

  it("acusa queda de mais de metade do volume", () => {
    const alerts = detectAlertsFromEvents({
      events: [...baseline(20), ...recent(5)],
      now: NOW,
      windowHours: WINDOW_HOURS,
    });
    const drop = alerts.find((alert) => alert.kind === "volume_drop");
    expect(drop?.severity).toBe("warning");
    expect(drop?.metrics.drop_percent).toBe(75);
  });

  it("campanha que zerou é crítica", () => {
    const alerts = detectAlertsFromEvents({
      events: baseline(20),
      now: NOW,
      windowHours: WINDOW_HOURS,
    });
    const drop = alerts.find((alert) => alert.kind === "volume_drop");
    expect(drop?.severity).toBe("critical");
    expect(drop?.title).toContain("parou de trazer leads");
  });

  /** 2 leads que viram 1 não são uma queda: é ruído de base pequena. */
  it("ignora base pequena demais para concluir qualquer coisa", () => {
    const alerts = detectAlertsFromEvents({
      events: [...baseline(3), ...recent(1)],
      now: NOW,
      windowHours: WINDOW_HOURS,
    });
    expect(alerts).toHaveLength(0);
  });

  it("acusa formulário silencioso", () => {
    const alerts = detectAlertsFromEvents({
      events: baseline(15),
      now: NOW,
      windowHours: WINDOW_HOURS,
    });
    const silent = alerts.find((alert) => alert.kind === "form_silent");
    expect(silent?.severity).toBe("critical");
    expect(silent?.scopeName).toBe("Formulário A");
  });

  it("acusa excesso de leads com erro", () => {
    const alerts = detectAlertsFromEvents({
      events: [
        ...recent(6, { current_step: "crm_lead_failed" }),
        ...recent(4),
      ],
      now: NOW,
      windowHours: WINDOW_HOURS,
    });
    const spike = alerts.find((alert) => alert.kind === "error_spike");
    expect(spike?.title).toContain("60%");
    expect(spike?.severity).toBe("critical");
  });

  it("acusa leads que ficaram sem agente", () => {
    const alerts = detectAlertsFromEvents({
      events: [...recent(5, { current_step: "skipped_no_agent" }), ...recent(5)],
      now: NOW,
      windowHours: WINDOW_HOURS,
    });
    expect(alerts.some((alert) => alert.kind === "no_agent_spike")).toBe(true);
  });

  it("descarta o que é mais velho que as duas janelas", () => {
    const alerts = detectAlertsFromEvents({
      events: [...Array.from({ length: 30 }, () => event({ hoursAgo: 100 })), ...recent(10)],
      now: NOW,
      windowHours: WINDOW_HOURS,
    });
    expect(alerts.some((alert) => alert.kind === "volume_drop")).toBe(false);
  });

  it("lista vazia não gera alerta", () => {
    expect(detectAlertsFromEvents({ events: [], now: NOW, windowHours: WINDOW_HOURS })).toHaveLength(0);
  });
});

describe("buildFingerprint", () => {
  it("o mesmo problema no mesmo dia tem a mesma assinatura", () => {
    expect(buildFingerprint("volume_drop", "camp-1", "2026-09-17")).toBe(
      buildFingerprint("volume_drop", "camp-1", "2026-09-17"),
    );
  });

  it("dias diferentes geram assinaturas diferentes", () => {
    expect(buildFingerprint("volume_drop", "camp-1", "2026-09-17")).not.toBe(
      buildFingerprint("volume_drop", "camp-1", "2026-09-18"),
    );
  });
});
