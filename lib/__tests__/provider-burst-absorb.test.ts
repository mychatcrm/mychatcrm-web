import { describe, expect, it } from "vitest";
import {
  isProviderBurstContinuation,
  isWithinProviderBurstWindow,
  mergeProviderBurstRows,
  PROVIDER_BURST_FORWARD_MS,
  resolveProviderBurstAnchorMs,
} from "@/lib/conversas/provider-burst-absorb";

describe("provider burst absorb", () => {
  const anchor = "2026-07-19T11:45:28.000Z";
  const anchorMs = Date.parse(anchor);

  it("resolveProviderBurstAnchorMs prefers job provider_first_message_at", () => {
    expect(
      resolveProviderBurstAnchorMs({
        providerFirstMessageAt: anchor,
        inboundRows: [{ id: "1", created_at: "2026-07-19T11:45:40.000Z" }],
      }),
    ).toBe(anchorMs);
  });

  it("absorbs the morning incident: Bom dia + agenda question in the same WA window", () => {
    const bomDia = {
      id: "9c36fe5a",
      created_at: "2026-07-19T11:45:28.000Z",
      received_at: "2026-07-19T11:45:31.000Z",
    };
    const agendaQ = {
      id: "954b4322",
      created_at: "2026-07-19T11:45:37.000Z",
      received_at: "2026-07-19T11:46:28.000Z",
    };
    expect(isWithinProviderBurstWindow(anchorMs, agendaQ.created_at)).toBe(true);
    const merged = mergeProviderBurstRows([bomDia], [agendaQ]);
    expect(merged.map((r) => r.id)).toEqual(["9c36fe5a", "954b4322"]);
  });

  it("does not absorb messages outside the 90s provider window", () => {
    const late = new Date(anchorMs + PROVIDER_BURST_FORWARD_MS + 5_000).toISOString();
    expect(isWithinProviderBurstWindow(anchorMs, late)).toBe(false);
  });

  it("treats a late webhook of an earlier WA message as burst continuation", () => {
    expect(
      isProviderBurstContinuation({
        inboundCreatedAt: "2026-07-19T11:45:37.000Z",
        burstAnchorCreatedAt: anchor,
        lastAgentResponseAt: "2026-07-19T11:45:56.000Z",
      }),
    ).toBe(true);
  });
});
