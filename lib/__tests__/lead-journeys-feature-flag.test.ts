import { afterEach, describe, expect, it } from "vitest";
import { isJourneyIsolationEnabled } from "@/lib/server/lead-journeys";

const originalFlag = process.env.OMNICHANNEL_JOURNEYS_ENABLED;
const originalVercelEnv = process.env.VERCEL_ENV;

afterEach(() => {
  if (originalFlag === undefined) delete process.env.OMNICHANNEL_JOURNEYS_ENABLED;
  else process.env.OMNICHANNEL_JOURNEYS_ENABLED = originalFlag;
  if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = originalVercelEnv;
});

describe("omnichannel journey feature flag", () => {
  it("honors the explicit enable and rollback values", () => {
    process.env.OMNICHANNEL_JOURNEYS_ENABLED = "true";
    expect(isJourneyIsolationEnabled()).toBe(true);
    process.env.OMNICHANNEL_JOURNEYS_ENABLED = "false";
    expect(isJourneyIsolationEnabled()).toBe(false);
  });

  it("defaults on only in production after the additive migration", () => {
    delete process.env.OMNICHANNEL_JOURNEYS_ENABLED;
    process.env.VERCEL_ENV = "production";
    expect(isJourneyIsolationEnabled()).toBe(true);
    process.env.VERCEL_ENV = "preview";
    expect(isJourneyIsolationEnabled()).toBe(false);
  });
});
