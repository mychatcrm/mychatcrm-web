import { describe, expect, it } from "vitest";
import { isJourneyIsolationEnabled } from "@/lib/server/lead-journeys";

describe("omnichannel journey isolation", () => {
  it("cannot be disabled by an environment rollback flag", () => {
    process.env.OMNICHANNEL_JOURNEYS_ENABLED = "false";
    expect(isJourneyIsolationEnabled()).toBe(true);
  });

  it("is mandatory in every runtime environment", () => {
    delete process.env.OMNICHANNEL_JOURNEYS_ENABLED;
    process.env.VERCEL_ENV = "preview";
    expect(isJourneyIsolationEnabled()).toBe(true);
  });
});
