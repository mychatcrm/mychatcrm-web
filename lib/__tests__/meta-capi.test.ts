import { beforeEach, describe, expect, it, vi } from "vitest";

const { metaGraphRequestMock, appendAuditMock } = vi.hoisted(() => ({
  metaGraphRequestMock: vi.fn(),
  appendAuditMock: vi.fn(),
}));

vi.mock("@/lib/server/meta-graph-api", () => ({
  metaGraphRequest: metaGraphRequestMock,
  metaGraphErrorCode: (error: unknown) => (error instanceof Error ? error.message : "unknown"),
}));
vi.mock("@/lib/server/operational-audit", () => ({ appendOperationalAuditEvent: appendAuditMock }));

import {
  deliverPendingCapiEvents,
  enqueueCapiForColumnChange,
  enqueueMetaCapiEvent,
  eventNameForColumn,
  sha256Lower,
} from "@/lib/server/meta-capi";

type Options = {
  lead?: Record<string, unknown> | null;
  rule?: Record<string, unknown> | null;
  insertError?: { code: string; message: string } | null;
  claimed?: unknown[];
  claimError?: { code: string; message: string } | null;
};

function makeSupabase(options: Options = {}) {
  const inserts: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];

  const client = {
    rpc: (_name: string, _args: unknown) =>
      Promise.resolve({ data: options.claimed ?? [], error: options.claimError ?? null }),
    from(table: string) {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: () =>
          Promise.resolve({
            data:
              table === "leads"
                ? (options.lead ?? null)
                : table === "lead_distribution_rules"
                  ? (options.rule ?? null)
                  : null,
            error: null,
          }),
        insert(payload: Record<string, unknown>) {
          inserts.push(payload);
          return {
            select: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: options.insertError ? null : { id: "outbox-1" },
                  error: options.insertError ?? null,
                }),
            }),
          };
        },
        update(payload: Record<string, unknown>) {
          updates.push(payload);
          return { eq: () => Promise.resolve({ error: null }) };
        },
      };
      return builder;
    },
  };

  return { client: client as never, inserts, updates };
}

const META_LEAD = {
  id: "lead-1",
  profile_metadata: { meta_leadgen_id: "1234567890" },
  campaign_rule_id: "rule-1",
  rule_id: "rule-1",
  source: "lead_ads",
};

const ENABLED_RULE = {
  id: "rule-1",
  conversion_send_enabled: true,
  conversion_pixel_id: "pixel-1",
  conversion_api_secret: "capi-token",
};

beforeEach(() => {
  metaGraphRequestMock.mockReset();
  appendAuditMock.mockReset();
  appendAuditMock.mockResolvedValue(null);
});

describe("eventNameForColumn", () => {
  it("coluna de fechamento vira Purchase", () => {
    expect(eventNameForColumn("fechado")).toBe("Purchase");
  });

  it("proposta e negociação viram Qualified", () => {
    expect(eventNameForColumn("proposta")).toBe("Qualified");
    expect(eventNameForColumn("negociacao")).toBe("Qualified");
  });

  it("coluna de entrada não gera conversão", () => {
    expect(eventNameForColumn("novo")).toBeNull();
    expect(eventNameForColumn("perdido")).toBeNull();
  });
});

describe("enqueueMetaCapiEvent", () => {
  it("enfileira sem enviar nenhum dado pessoal", async () => {
    const { client, inserts } = makeSupabase({ lead: META_LEAD, rule: ENABLED_RULE });

    const result = await enqueueMetaCapiEvent({
      sb: client, tenantId: "t", leadId: "lead-1", eventName: "Purchase",
    });

    expect(result).toEqual({ queued: true, id: "outbox-1" });
    const payload = inserts[0] as Record<string, unknown>;
    expect(payload.leadgen_id).toBe("1234567890");
    expect(JSON.stringify(payload)).not.toContain("@");
    expect(JSON.stringify(payload)).not.toMatch(/\d{11}/);
  });

  it("lead sem origem Meta não entra na fila", async () => {
    const { client, inserts } = makeSupabase({
      lead: { id: "lead-1", profile_metadata: {}, campaign_rule_id: "rule-1" },
      rule: ENABLED_RULE,
    });

    const result = await enqueueMetaCapiEvent({
      sb: client, tenantId: "t", leadId: "lead-1", eventName: "Purchase",
    });

    expect(result).toEqual({ queued: false, reason: "no_meta_lead" });
    expect(inserts).toHaveLength(0);
  });

  it("regra com envio desligado não enfileira", async () => {
    const { client, inserts } = makeSupabase({
      lead: META_LEAD,
      rule: { ...ENABLED_RULE, conversion_send_enabled: false },
    });

    expect(
      await enqueueMetaCapiEvent({ sb: client, tenantId: "t", leadId: "lead-1", eventName: "Purchase" }),
    ).toEqual({ queued: false, reason: "not_configured" });
    expect(inserts).toHaveLength(0);
  });

  it("regra sem pixel ou sem token não enfileira", async () => {
    const { client } = makeSupabase({
      lead: META_LEAD,
      rule: { ...ENABLED_RULE, conversion_pixel_id: "  " },
    });

    expect(
      await enqueueMetaCapiEvent({ sb: client, tenantId: "t", leadId: "lead-1", eventName: "Purchase" }),
    ).toEqual({ queued: false, reason: "not_configured" });
  });

  it("o mesmo desfecho não vira duas conversões", async () => {
    const { client } = makeSupabase({
      lead: META_LEAD,
      rule: ENABLED_RULE,
      insertError: { code: "23505", message: "duplicate key" },
    });

    expect(
      await enqueueMetaCapiEvent({ sb: client, tenantId: "t", leadId: "lead-1", eventName: "Purchase" }),
    ).toEqual({ queued: false, reason: "duplicate" });
  });

  it("sem a migração aplicada avisa em vez de falhar", async () => {
    const { client } = makeSupabase({
      lead: META_LEAD,
      rule: ENABLED_RULE,
      insertError: { code: "42P01", message: "relation does not exist" },
    });

    expect(
      await enqueueMetaCapiEvent({ sb: client, tenantId: "t", leadId: "lead-1", eventName: "Purchase" }),
    ).toEqual({ queued: false, reason: "schema_pending" });
  });

  /** A venda do cliente não pode falhar porque a fila de marketing quebrou. */
  it("nunca lança, mesmo com o banco fora do ar", async () => {
    const client = {
      from() {
        throw new Error("connection refused");
      },
    } as never;

    await expect(
      enqueueMetaCapiEvent({ sb: client, tenantId: "t", leadId: "lead-1", eventName: "Purchase" }),
    ).resolves.toEqual({ queued: false, reason: "failed" });
  });
});

describe("enqueueCapiForColumnChange", () => {
  it("coluna sem significado comercial não gera evento", async () => {
    const { client, inserts } = makeSupabase({ lead: META_LEAD, rule: ENABLED_RULE });
    expect(
      await enqueueCapiForColumnChange({ sb: client, tenantId: "t", leadId: "lead-1", columnId: "novo" }),
    ).toBeNull();
    expect(inserts).toHaveLength(0);
  });

  it("coluna de fechamento gera Purchase", async () => {
    const { client, inserts } = makeSupabase({ lead: META_LEAD, rule: ENABLED_RULE });
    await enqueueCapiForColumnChange({ sb: client, tenantId: "t", leadId: "lead-1", columnId: "fechado" });
    expect((inserts[0] as { event_name?: string }).event_name).toBe("Purchase");
  });
});

describe("deliverPendingCapiEvents", () => {
  const CLAIMED = [
    {
      id: "outbox-1",
      tenant_id: "t",
      lead_id: "lead-1",
      leadgen_id: "1234567890",
      rule_id: "rule-1",
      event_name: "Purchase",
      event_time: "2026-09-17T12:00:00Z",
      pixel_id: "pixel-1",
      payload: { value: 1500, currency: "BRL" },
      attempts: 1,
      max_attempts: 6,
    },
  ];

  it("envia identificando pelo leadgen_id, sem dado pessoal", async () => {
    metaGraphRequestMock.mockResolvedValue({ events_received: 1 });
    const { client, updates } = makeSupabase({ claimed: CLAIMED, rule: ENABLED_RULE });

    const result = await deliverPendingCapiEvents({ sb: client });

    expect(result.sent).toBe(1);
    const [, options] = metaGraphRequestMock.mock.calls[0] as [string, { form: { data: string } }];
    const body = JSON.parse(options.form.data) as Array<Record<string, unknown>>;
    expect(body[0]?.action_source).toBe("system_generated");
    expect((body[0]?.user_data as Record<string, unknown>).lead_id).toBe(1234567890);
    expect(JSON.stringify(body)).not.toContain("phone");
    expect(JSON.stringify(body)).not.toContain("email");
    expect((updates[0] as { status?: string }).status).toBe("sent");
  });

  it("envia valor e moeda quando existem", async () => {
    metaGraphRequestMock.mockResolvedValue({});
    const { client } = makeSupabase({ claimed: CLAIMED, rule: ENABLED_RULE });

    await deliverPendingCapiEvents({ sb: client });

    const [, options] = metaGraphRequestMock.mock.calls[0] as [string, { form: { data: string } }];
    const body = JSON.parse(options.form.data) as Array<Record<string, unknown>>;
    expect(body[0]?.custom_data).toEqual({ value: 1500, currency: "BRL" });
  });

  it("envio desligado depois de enfileirar vira 'skipped', não erro", async () => {
    const { client, updates } = makeSupabase({
      claimed: CLAIMED,
      rule: { ...ENABLED_RULE, conversion_send_enabled: false },
    });

    const result = await deliverPendingCapiEvents({ sb: client });

    expect(result.skipped).toBe(1);
    expect(metaGraphRequestMock).not.toHaveBeenCalled();
    expect((updates[0] as { status?: string }).status).toBe("skipped");
  });

  it("falha reagenda com recuo exponencial", async () => {
    metaGraphRequestMock.mockRejectedValue(new Error("rate_limited"));
    const { client, updates } = makeSupabase({ claimed: CLAIMED, rule: ENABLED_RULE });

    const result = await deliverPendingCapiEvents({ sb: client });

    expect(result.failed).toBe(1);
    const patch = updates[0] as { status?: string; next_attempt_at?: string };
    expect(patch.status).toBe("pending");
    expect(new Date(patch.next_attempt_at as string).getTime()).toBeGreaterThan(Date.now());
  });

  it("tentativas esgotadas encerram o evento", async () => {
    metaGraphRequestMock.mockRejectedValue(new Error("permanent"));
    const { client, updates } = makeSupabase({
      claimed: [{ ...CLAIMED[0], attempts: 6, max_attempts: 6 }],
      rule: ENABLED_RULE,
    });

    await deliverPendingCapiEvents({ sb: client });
    expect((updates[0] as { status?: string }).status).toBe("failed");
  });

  it("sem a RPC no banco devolve zero em vez de quebrar o worker", async () => {
    const { client } = makeSupabase({ claimError: { code: "42883", message: "function does not exist" } });
    expect(await deliverPendingCapiEvents({ sb: client })).toEqual({
      claimed: 0, sent: 0, failed: 0, skipped: 0,
    });
  });
});

describe("sha256Lower", () => {
  it("normaliza antes de gerar o hash", () => {
    expect(sha256Lower("  Ana@Email.com ")).toBe(sha256Lower("ana@email.com"));
  });
});
