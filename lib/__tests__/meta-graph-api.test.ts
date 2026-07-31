import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MetaGraphRequestError,
  metaGraphRequest,
} from "@/lib/server/meta-graph-api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("metaGraphRequest", () => {
  it("keeps access tokens out of URLs and sends them in Authorization", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ id: "page-1" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await metaGraphRequest<{ id: string }>("/page-1", {
      accessToken: "EA-secret-token-value",
      searchParams: { fields: "id", access_token: "must-be-removed" },
    });

    const [requestUrl, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(requestUrl)).not.toContain("EA-secret-token-value");
    expect(String(requestUrl)).not.toContain("must-be-removed");
    expect(new Headers((init as RequestInit).headers).get("authorization")).toBe(
      "Bearer EA-secret-token-value",
    );
  });

  it("rejects pagination URLs outside graph.facebook.com", async () => {
    await expect(
      metaGraphRequest("https://attacker.example/next", {
        accessToken: "token",
      }),
    ).rejects.toBeInstanceOf(MetaGraphRequestError);
  });
});
