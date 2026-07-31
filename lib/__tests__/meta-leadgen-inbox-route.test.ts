import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyInternalApiRequest = vi.hoisted(() => vi.fn(() => false));
vi.mock("@/lib/server/internal-api-auth", () => ({
  verifyInternalApiRequest,
}));

const processMetaLeadgenInbox = vi.hoisted(() =>
  vi.fn(async () => ({
    claimed: 1,
    completed: 1,
    retrying: 0,
    deadLetter: 0,
    claimLost: 0,
    errors: 0,
  })),
);
vi.mock("@/lib/server/meta-leadgen-inbox", () => ({
  processMetaLeadgenInbox,
}));

import { POST } from "@/app/api/internal/meta-leadgen-inbox/process/route";

describe("POST /api/internal/meta-leadgen-inbox/process", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyInternalApiRequest.mockReturnValue(false);
  });

  it("rejects requests without an internal cron secret", async () => {
    const response = await POST(
      new Request("https://www.mychatcrm.com.br/api/internal/meta-leadgen-inbox/process", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(401);
    expect(processMetaLeadgenInbox).not.toHaveBeenCalled();
  });

  it("processes a bounded batch for an authenticated cron request", async () => {
    verifyInternalApiRequest.mockReturnValue(true);

    const response = await POST(
      new Request("https://www.mychatcrm.com.br/api/internal/meta-leadgen-inbox/process", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(processMetaLeadgenInbox).toHaveBeenCalledWith({ limit: 5 });
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      claimed: 1,
      completed: 1,
    });
  });
});
