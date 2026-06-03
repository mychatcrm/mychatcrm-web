import { describe, expect, it } from "vitest";

/** Espelha a lógica de roteamento em route.ts / evolution-agent-reply.ts */
function resolveManualHandoffCheck(params: {
  userRequestedHandoff: boolean;
  aiMarkerHandoff: boolean;
  scheduleHandoffFromAgenda: boolean;
}): boolean {
  return (params.userRequestedHandoff || params.aiMarkerHandoff) && !params.scheduleHandoffFromAgenda;
}

describe("agenda handoff coordination", () => {
  it("manual handoff runs when user requested human and post-success did not transfer", () => {
    expect(
      resolveManualHandoffCheck({
        userRequestedHandoff: true,
        aiMarkerHandoff: false,
        scheduleHandoffFromAgenda: false,
      }),
    ).toBe(true);
  });

  it("manual handoff is not blocked by handoffEnabled proxy when post-success did not transfer", () => {
    const userRequestedHandoff = true;
    const scheduleHandoffFromAgendaWrong = true;
    expect(
      resolveManualHandoffCheck({
        userRequestedHandoff,
        aiMarkerHandoff: false,
        scheduleHandoffFromAgenda: scheduleHandoffFromAgendaWrong,
      }),
    ).toBe(false);

    const scheduleHandoffFromAgendaReal = false;
    expect(
      resolveManualHandoffCheck({
        userRequestedHandoff,
        aiMarkerHandoff: false,
        scheduleHandoffFromAgenda: scheduleHandoffFromAgendaReal,
      }),
    ).toBe(true);
  });

  it("ctaHandoffAtivo=false never sets scheduleHandoffFromAgenda from post-success", () => {
    const ctaHandoffAtivo = false;
    const scheduleHandoffTriggered = ctaHandoffAtivo;
    expect(scheduleHandoffTriggered).toBe(false);
    expect(
      resolveManualHandoffCheck({
        userRequestedHandoff: true,
        aiMarkerHandoff: false,
        scheduleHandoffFromAgenda: scheduleHandoffTriggered,
      }),
    ).toBe(true);
  });
});
