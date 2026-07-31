import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildLeadProfileMetadata,
  extractLeadgenAttributionFromWebhook,
  resolveMetaLeadAdAttribution,
} from "@/lib/server/meta-lead-graph";
import {
  formatMetaAdDisplay,
  formatMetaAdsetDisplay,
  formatMetaAttributionLabel,
  formatMetaCampaignDisplay,
  parseMetaLeadProfileMetadata,
} from "@/lib/meta-leads/form-metadata";

describe("extractLeadgenAttributionFromWebhook", () => {
  it("reads ad_id and adgroup_id from webhook payload", () => {
    expect(
      extractLeadgenAttributionFromWebhook({
        ad_id: "120987",
        adgroup_id: "456789",
      }),
    ).toEqual({ adId: "120987", adsetId: "456789" });
  });
});

describe("resolveMetaLeadAdAttribution", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses ad_id from Graph lead and expands campaign/adset/ad names", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      const fields = new URL(url).searchParams.get("fields");
      if (
        url.includes("/120999") &&
        fields === "name,campaign{id,name},adset{id,name}"
      ) {
        return new Response(
          JSON.stringify({
            name: "Anúncio Principal",
            campaign: { id: "camp-1", name: "Campanha Verão" },
            adset: { id: "adset-9", name: "Conjunto Centro" },
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });

    const resolved = await resolveMetaLeadAdAttribution({
      pageAccessToken: "token",
      graphLead: { id: "lg-1", ad_id: "120999", form_id: "form-1" },
      webhook: { adgroup_id: "stale-adset" },
    });

    expect(resolved).toMatchObject({
      adId: "120999",
      formId: "form-1",
      adName: "Anúncio Principal",
      campaignId: "camp-1",
      campaignName: "Campanha Verão",
      adsetId: "adset-9",
      adsetName: "Conjunto Centro",
    });
  });

  it("fetches adset name by ID when ad node is unavailable", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (
        url.includes("/adset-77") &&
        new URL(url).searchParams.get("fields") === "name"
      ) {
        return new Response(JSON.stringify({ name: "Conjunto Norte" }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });

    const resolved = await resolveMetaLeadAdAttribution({
      pageAccessToken: "token",
      webhookAdsetId: "adset-77",
    });

    expect(resolved.adsetId).toBe("adset-77");
    expect(resolved.adsetName).toBe("Conjunto Norte");
  });

  it("usa o token de usuário (não o de página) pra ler campanha/conjunto/anúncio", async () => {
    // A Meta exige token de usuário pra objetos de conta de anúncio — o de
    // página sempre volta "does not exist / missing permissions" mesmo com
    // ads_read concedido (confirmado testando o mesmo ad_id nos dois tokens
    // contra a API real). Regressão: garante que a chamada usa userAccessToken,
    // nunca pageAccessToken, quando ambos estão presentes. O token viaja no
    // cabeçalho Authorization (não na URL), para não vazar em log de acesso.
    const sentTokens: string[] = [];
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      sentTokens.push(String(new Headers(init?.headers).get("authorization") ?? url));
      if (url.includes("/ad-1")) {
        return new Response(
          JSON.stringify({
            name: "Anúncio X",
            campaign: { id: "camp-1", name: "Campanha X" },
            adset: { id: "adset-1", name: "Conjunto X" },
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });

    const resolved = await resolveMetaLeadAdAttribution({
      pageAccessToken: "page-token-sem-ads-read",
      userAccessToken: "user-token-com-ads-read",
      graphLead: { id: "lg-1", ad_id: "ad-1", form_id: "form-1" },
    });

    expect(resolved.campaignName).toBe("Campanha X");
    expect(sentTokens.some((t) => t.includes("user-token-com-ads-read"))).toBe(true);
    expect(sentTokens.some((t) => t.includes("page-token-sem-ads-read"))).toBe(false);
  });

  it("cai pro token de página quando não há token de usuário salvo (compatibilidade)", async () => {
    const sentTokens: string[] = [];
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockImplementation(async (input, init) => {
      sentTokens.push(String(new Headers(init?.headers).get("authorization") ?? input));
      return new Response(JSON.stringify({ name: "Anúncio Y" }), { status: 200 });
    });

    await resolveMetaLeadAdAttribution({
      pageAccessToken: "page-token-only",
      graphLead: { id: "lg-2", ad_id: "ad-2", form_id: "form-2" },
    });

    expect(sentTokens.some((t) => t.includes("page-token-only"))).toBe(true);
  });
});

describe("buildLeadProfileMetadata campaign fields", () => {
  it("persists meta_* ids and names for new leads", () => {
    const meta = buildLeadProfileMetadata({
      leadgenId: "lg-99",
      fieldData: [],
      campaignId: "camp-1",
      campaignName: null,
      adsetId: "adset-2",
      adsetName: "Conjunto A",
      adId: "ad-3",
      adName: null,
      pageId: "page-1",
      pageName: null,
      questionLabels: new Map(),
    });
    expect(meta.meta_campaign_id).toBe("camp-1");
    expect(meta.meta_campaign_name).toBeUndefined();
    expect(meta.meta_adset_id).toBe("adset-2");
    expect(meta.meta_adset_name).toBe("Conjunto A");
    expect(meta.meta_ad_id).toBe("ad-3");
    expect(meta.meta_ad_name).toBeUndefined();
  });
});

describe("CRM attribution display labels", () => {
  it("prefers name over id", () => {
    const meta = parseMetaLeadProfileMetadata({
      meta_campaign_name: "Campanha X",
      meta_campaign_id: "111",
    });
    expect(formatMetaCampaignDisplay(meta)).toBe("Campanha X");
  });

  it("falls back to id when name is missing", () => {
    const meta = parseMetaLeadProfileMetadata({
      meta_adset_id: "adset-42",
    });
    expect(formatMetaAdsetDisplay(meta)).toBe("adset-42");
  });

  it("shows em dash when empty", () => {
    expect(formatMetaAttributionLabel(null, null)).toBe("—");
    expect(formatMetaAdDisplay(parseMetaLeadProfileMetadata({}))).toBe("—");
  });
});
