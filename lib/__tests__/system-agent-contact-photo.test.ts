import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getAdminSessionFromCookies = vi.hoisted(() => vi.fn());
const hasAdminAccess = vi.hoisted(() => vi.fn());
vi.mock("@/lib/admin-auth", () => ({
  getAdminSessionFromCookies,
  hasAdminAccess,
}));

const fetchContactPhoto = vi.hoisted(() => vi.fn());
vi.mock("@/lib/integrations/evolution-api", () => ({
  fetchContactPhoto,
}));

const getEvolutionInstanceByTenantSlot = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/tenant-evolution-instance-db", () => ({
  getEvolutionInstanceByTenantSlot,
}));

vi.mock("@/lib/server/system-agent", () => ({
  SYSTEM_SLOT_INDEX: 0,
  SYSTEM_TENANT_ID: "tenant-system-internal",
}));

import { GET } from "@/app/api/admin/system-agent/conversations/[jid]/photo/route";

const JID = "5562993580574@s.whatsapp.net";

function request() {
  return new Request(`https://www.mychatcrm.com.br/api/admin/system-agent/conversations/${encodeURIComponent(JID)}/photo`);
}

describe("GET /api/admin/system-agent/conversations/[jid]/photo", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    getAdminSessionFromCookies.mockResolvedValue({ id: "admin" });
    hasAdminAccess.mockReturnValue(true);
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects unauthenticated requests", async () => {
    getAdminSessionFromCookies.mockResolvedValueOnce(null);

    const response = await GET(request(), { params: { jid: encodeURIComponent(JID) } });

    expect(response.status).toBe(403);
    expect(getEvolutionInstanceByTenantSlot).not.toHaveBeenCalled();
  });

  it("returns 404 when the system agent has no Evolution instance (e.g. only Meta connected)", async () => {
    getEvolutionInstanceByTenantSlot.mockResolvedValue(null);

    const response = await GET(request(), { params: { jid: encodeURIComponent(JID) } });

    expect(response.status).toBe(404);
    expect(fetchContactPhoto).not.toHaveBeenCalled();
  });

  it("returns 404 when the contact has no public profile photo", async () => {
    getEvolutionInstanceByTenantSlot.mockResolvedValue({ instance_name: "mc-system-0" });
    fetchContactPhoto.mockResolvedValue(null);

    const response = await GET(request(), { params: { jid: encodeURIComponent(JID) } });

    expect(response.status).toBe(404);
    expect(fetchContactPhoto).toHaveBeenCalledWith("mc-system-0", JID);
  });

  it("proxies the photo bytes with a cache header when found", async () => {
    getEvolutionInstanceByTenantSlot.mockResolvedValue({ instance_name: "mc-system-0" });
    fetchContactPhoto.mockResolvedValue("https://pps.whatsapp.net/v/photo.jpg");
    fetchMock.mockResolvedValueOnce(
      new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "Content-Type": "image/jpeg" } }),
    );

    const response = await GET(request(), { params: { jid: encodeURIComponent(JID) } });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
    expect(response.headers.get("Cache-Control")).toContain("max-age=3600");
  });
});
