import { beforeEach, describe, expect, it, vi } from "vitest";

const getAdminSessionFromCookies = vi.hoisted(() => vi.fn());
const hasAdminAccess = vi.hoisted(() => vi.fn());
vi.mock("@/lib/admin-auth", () => ({
  getAdminSessionFromCookies,
  hasAdminAccess,
}));

const fetchWhatsAppMessageTemplateStatus = vi.hoisted(() => vi.fn());
const createWhatsAppMessageTemplate = vi.hoisted(() => vi.fn());
vi.mock("@/lib/integrations/whatsapp-cloud", () => ({
  fetchWhatsAppMessageTemplateStatus,
  createWhatsAppMessageTemplate,
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

import {
  PATCH,
  POST,
} from "@/app/api/admin/system-agent/meta/config/route";

const SYSTEM_NOTIFICATION_TEMPLATE_NAME = "mychatcrm_agenda_notification_v1";

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
      template_status: "APPROVED",
      warning: null,
    });
    expect(saveSystemAgentMetaTemplate).toHaveBeenCalledWith({
      templateName: "system_notification",
      templateLang: "pt_BR",
      templateStatus: "APPROVED",
    });
  });

  it("saves a pending template and keeps notifications queued until approval", async () => {
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
    expect(saveSystemAgentMetaTemplate).toHaveBeenCalledWith({
      templateName: null,
      templateLang: null,
      templateStatus: null,
    });
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

describe("POST /api/admin/system-agent/meta/config — provisions the utility template", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAdminSessionFromCookies.mockResolvedValue({ id: "admin" });
    hasAdminAccess.mockReturnValue(true);
    getSystemAgentMetaConfig.mockResolvedValue({ wabaId: "WABA1", accessToken: "token-abc" });
  });

  it("reuses an existing approved template without creating a duplicate", async () => {
    fetchWhatsAppMessageTemplateStatus.mockResolvedValue({
      found: true,
      status: "APPROVED",
      category: "UTILITY",
    });

    const response = await POST();

    expect(response.status).toBe(200);
    expect(createWhatsAppMessageTemplate).not.toHaveBeenCalled();
    expect(saveSystemAgentMetaTemplate).toHaveBeenCalledWith({
      templateName: SYSTEM_NOTIFICATION_TEMPLATE_NAME,
      templateLang: "pt_BR",
      templateStatus: "APPROVED",
    });
  });

  it("creates and saves a pending template for automatic approval tracking", async () => {
    fetchWhatsAppMessageTemplateStatus.mockResolvedValue({
      found: false,
      status: null,
      category: null,
    });
    createWhatsAppMessageTemplate.mockResolvedValue({
      ok: true,
      status: 200,
      templateStatus: "PENDING",
      id: "template-1",
    });

    const response = await POST();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      template_name: SYSTEM_NOTIFICATION_TEMPLATE_NAME,
      template_status: "PENDING",
      created: true,
    });
    expect(saveSystemAgentMetaTemplate).toHaveBeenCalledWith({
      templateName: SYSTEM_NOTIFICATION_TEMPLATE_NAME,
      templateLang: "pt_BR",
      templateStatus: "PENDING",
    });
  });
});
