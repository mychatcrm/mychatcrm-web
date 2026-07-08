import { beforeEach, describe, expect, it, vi } from "vitest";

const getAdminSessionFromCookies = vi.hoisted(() => vi.fn());
const hasAdminAccess = vi.hoisted(() => vi.fn());
vi.mock("@/lib/admin-auth", () => ({
  getAdminSessionFromCookies,
  hasAdminAccess,
}));

const fetchWhatsAppMessageTemplateStatus = vi.hoisted(() => vi.fn());
vi.mock("@/lib/integrations/whatsapp-cloud", () => ({
  fetchWhatsAppMessageTemplateStatus,
}));

const getSystemAgentMetaConfig = vi.hoisted(() => vi.fn());
const saveSystemAgentMetaTemplate = vi.hoisted(() => vi.fn());
const setSystemActiveProvider = vi.hoisted(() => vi.fn());
const clearSystemAgentMetaConfig = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/system-agent", () => ({
  getSystemAgentMetaConfig,
  saveSystemAgentMetaTemplate,
  setSystemActiveProvider,
  clearSystemAgentMetaConfig,
}));

import { PATCH } from "@/app/api/admin/system-agent/meta/config/route";

function patchRequest(body: Record<string, unknown>) {
  return new Request("https://www.mychatcrm.com.br/api/admin/system-agent/meta/config", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/admin/system-agent/meta/config — validates the template against the Meta WABA", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAdminSessionFromCookies.mockResolvedValue({ id: "admin" });
    hasAdminAccess.mockReturnValue(true);
  });

  it("rejects a template name that does not exist on the WABA, without saving it", async () => {
    getSystemAgentMetaConfig.mockResolvedValue({ wabaId: "WABA1", accessToken: "token-abc" });
    fetchWhatsAppMessageTemplateStatus.mockResolvedValue({ found: false, status: null, category: null });

    const response = await PATCH(patchRequest({ template_name: "nome_errado", template_lang: "pt_BR" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("não existe") });
    expect(saveSystemAgentMetaTemplate).not.toHaveBeenCalled();
  });

  it("rejects a template that Meta has rejected, without saving it", async () => {
    getSystemAgentMetaConfig.mockResolvedValue({ wabaId: "WABA1", accessToken: "token-abc" });
    fetchWhatsAppMessageTemplateStatus.mockResolvedValue({ found: true, status: "REJECTED", category: "UTILITY" });

    const response = await PATCH(patchRequest({ template_name: "system_notification", template_lang: "pt_BR" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("rejeitado") });
    expect(saveSystemAgentMetaTemplate).not.toHaveBeenCalled();
  });

  it("saves an approved template with no warning", async () => {
    getSystemAgentMetaConfig.mockResolvedValue({ wabaId: "WABA1", accessToken: "token-abc" });
    fetchWhatsAppMessageTemplateStatus.mockResolvedValue({ found: true, status: "APPROVED", category: "UTILITY" });

    const response = await PATCH(patchRequest({ template_name: "system_notification", template_lang: "pt_BR" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      template_name: "system_notification",
      template_lang: "pt_BR",
      warning: null,
    });
    expect(saveSystemAgentMetaTemplate).toHaveBeenCalledWith({
      templateName: "system_notification",
      templateLang: "pt_BR",
    });
  });

  it("saves a pending template but warns that dispatches will fail until it's approved", async () => {
    getSystemAgentMetaConfig.mockResolvedValue({ wabaId: "WABA1", accessToken: "token-abc" });
    fetchWhatsAppMessageTemplateStatus.mockResolvedValue({ found: true, status: "PENDING", category: "UTILITY" });

    const response = await PATCH(patchRequest({ template_name: "system_notification", template_lang: "pt_BR" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      template_name: "system_notification",
      warning: expect.stringContaining("em análise"),
    });
    expect(saveSystemAgentMetaTemplate).toHaveBeenCalled();
  });

  it("clears the template without calling the Meta API when the name is blank", async () => {
    const response = await PATCH(patchRequest({ template_name: "", template_lang: "" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, template_name: null, template_lang: null });
    expect(fetchWhatsAppMessageTemplateStatus).not.toHaveBeenCalled();
    expect(saveSystemAgentMetaTemplate).toHaveBeenCalledWith({ templateName: null, templateLang: null });
  });

  it("blocks template validation with a clear message when the WABA id isn't saved yet", async () => {
    getSystemAgentMetaConfig.mockResolvedValue({ wabaId: null, accessToken: "token-abc" });

    const response = await PATCH(patchRequest({ template_name: "system_notification", template_lang: "pt_BR" }));

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("WABA") });
    expect(fetchWhatsAppMessageTemplateStatus).not.toHaveBeenCalled();
    expect(saveSystemAgentMetaTemplate).not.toHaveBeenCalled();
  });
});
