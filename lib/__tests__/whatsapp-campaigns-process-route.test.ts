import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireActiveClientSessionMock, createSupabaseServiceClientMock, processDueWhatsAppCampaignsMock } = vi.hoisted(() => ({
  requireActiveClientSessionMock: vi.fn(),
  createSupabaseServiceClientMock: vi.fn(),
  processDueWhatsAppCampaignsMock: vi.fn(),
}));

vi.mock("@/lib/server/client-session-guard", () => ({
  requireActiveClientSession: requireActiveClientSessionMock,
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: createSupabaseServiceClientMock,
}));
vi.mock("@/lib/server/whatsapp-campaigns", () => ({
  processDueWhatsAppCampaigns: processDueWhatsAppCampaignsMock,
}));

import { POST } from "@/app/api/client/whatsapp-campaigns/[id]/process/route";

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/client/whatsapp-campaigns/[id]/process", () => {
  beforeEach(() => {
    requireActiveClientSessionMock.mockReset();
    createSupabaseServiceClientMock.mockReset();
    processDueWhatsAppCampaignsMock.mockReset();
    requireActiveClientSessionMock.mockResolvedValue({ ok: true, session: { tenantId: "tenant-1" } });
  });

  it("roda uma passada para a campanha e devolve o resultado", async () => {
    createSupabaseServiceClientMock.mockReturnValue({
      from: (table: string) => {
        expect(table).toBe("whatsapp_campaigns");
        const builder: Record<string, unknown> = {};
        builder.select = () => builder;
        builder.eq = () => builder;
        builder.maybeSingle = async () => ({ data: { id: "camp-1" }, error: null });
        return builder;
      },
    });
    processDueWhatsAppCampaignsMock.mockResolvedValue({ processed: 3, outcomes: { sent: 3 } });

    const res = await POST(new Request("https://example.test", { method: "POST" }), ctx("camp-1"));
    const body = await res.json();

    expect(processDueWhatsAppCampaignsMock).toHaveBeenCalledWith(expect.anything(), { campaignId: "camp-1" });
    expect(body).toEqual({ ok: true, processed: 3, outcomes: { sent: 3 } });
  });

  it("retorna 404 quando a campanha não pertence ao tenant", async () => {
    createSupabaseServiceClientMock.mockReturnValue({
      from: () => {
        const builder: Record<string, unknown> = {};
        builder.select = () => builder;
        builder.eq = () => builder;
        builder.maybeSingle = async () => ({ data: null, error: null });
        return builder;
      },
    });

    const res = await POST(new Request("https://example.test", { method: "POST" }), ctx("camp-inexistente"));

    expect(res.status).toBe(404);
    expect(processDueWhatsAppCampaignsMock).not.toHaveBeenCalled();
  });

  it("retorna 401 sem sessão", async () => {
    requireActiveClientSessionMock.mockResolvedValue({ ok: false, response: Response.json({ error: "Não autenticado." }, { status: 401 }) });
    const res = await POST(new Request("https://example.test", { method: "POST" }), ctx("camp-1"));
    expect(res.status).toBe(401);
  });
});
