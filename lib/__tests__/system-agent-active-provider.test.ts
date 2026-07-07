import { beforeEach, describe, expect, it, vi } from "vitest";

const { maybeSingleMock, updateMock } = vi.hoisted(() => ({
  maybeSingleMock: vi.fn(),
  updateMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: maybeSingleMock,
          }),
        }),
      }),
      update: (patch: Record<string, unknown>) => {
        updateMock(patch);
        return {
          eq: () => ({
            eq: () => Promise.resolve({ error: null }),
          }),
        };
      },
    }),
  }),
}));

import {
  getSystemActiveProvider,
  isMetaProviderActive,
  setSystemActiveProvider,
} from "@/lib/server/system-agent";

describe("system agent active-provider toggle (QR Code vs API Meta)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports Meta inactive when no metadata exists yet", async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null });

    expect(await isMetaProviderActive()).toBe(false);
    expect(await getSystemActiveProvider()).toBe("evolution");
  });

  it("reports Meta inactive when credentials are saved but the toggle points to Evolution", async () => {
    maybeSingleMock.mockResolvedValue({
      data: {
        metadata: {
          meta_phone_number_id: "123456789012345",
          meta_access_token: "token-abc",
          meta_provider_active: false,
        },
      },
      error: null,
    });

    expect(await isMetaProviderActive()).toBe(false);
    expect(await getSystemActiveProvider()).toBe("evolution");
  });

  it("reports Meta active only when meta_provider_active is true AND credentials exist", async () => {
    maybeSingleMock.mockResolvedValue({
      data: {
        metadata: {
          meta_phone_number_id: "123456789012345",
          meta_access_token: "token-abc",
          meta_provider_active: true,
        },
      },
      error: null,
    });

    expect(await isMetaProviderActive()).toBe(true);
    expect(await getSystemActiveProvider()).toBe("meta");
  });

  it("does not report Meta active if the toggle is true but credentials are missing (inconsistent state)", async () => {
    maybeSingleMock.mockResolvedValue({
      data: { metadata: { meta_provider_active: true } },
      error: null,
    });

    expect(await isMetaProviderActive()).toBe(false);
  });

  it("setSystemActiveProvider('meta') persists meta_provider_active: true", async () => {
    maybeSingleMock.mockResolvedValue({ data: { metadata: {} }, error: null });

    await setSystemActiveProvider("meta");

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ meta_provider_active: true }) }),
    );
  });

  it("setSystemActiveProvider('evolution') persists meta_provider_active: false, taking Meta out of the loop", async () => {
    maybeSingleMock.mockResolvedValue({
      data: { metadata: { meta_phone_number_id: "123456789012345", meta_provider_active: true } },
      error: null,
    });

    await setSystemActiveProvider("evolution");

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ meta_provider_active: false }) }),
    );
  });
});
