import { describe, expect, it } from "vitest";

function conversationMatchesTransport(
  channel: "evolution" | "meta_cloud" | null | undefined,
  transport: "all" | "evolution" | "cloud_api",
): boolean {
  if (transport === "all") return true;
  if (transport === "cloud_api") return channel === "meta_cloud";
  return channel === "evolution" || !channel;
}

describe("conversas transport filter", () => {
  it("matches Meta Cloud channel to API Meta filter", () => {
    expect(conversationMatchesTransport("meta_cloud", "cloud_api")).toBe(true);
    expect(conversationMatchesTransport("evolution", "cloud_api")).toBe(false);
  });

  it("treats unknown channel as QR for evolution filter", () => {
    expect(conversationMatchesTransport(null, "evolution")).toBe(true);
    expect(conversationMatchesTransport("evolution", "evolution")).toBe(true);
    expect(conversationMatchesTransport("meta_cloud", "evolution")).toBe(false);
  });
});
