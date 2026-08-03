import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const callbackSource = readFileSync(
  new URL("../../app/api/meta/callback/route.ts", import.meta.url),
  "utf8",
);

describe("Meta OAuth callback resilience", () => {
  it("keeps the optional /me identity probe outside page discovery", () => {
    const optionalIdentityFailure = callbackSource.indexOf(
      "optional grant identity lookup failed",
    );
    const pageDiscovery = callbackSource.indexOf(
      'await fetchPagesAttempt("me/accounts", "/me/accounts")',
    );

    expect(optionalIdentityFailure).toBeGreaterThan(-1);
    expect(pageDiscovery).toBeGreaterThan(optionalIdentityFailure);
    expect(callbackSource.slice(optionalIdentityFailure, pageDiscovery)).toContain(
      "\n  }\n\n  try {",
    );
  });

  it("does not map an optional identity failure to the network redirect", () => {
    const optionalIdentityFailure = callbackSource.indexOf(
      "optional grant identity lookup failed",
    );
    const pageDiscovery = callbackSource.indexOf(
      'await fetchPagesAttempt("me/accounts", "/me/accounts")',
    );

    expect(
      callbackSource.slice(optionalIdentityFailure, pageDiscovery),
    ).not.toContain("meta=error&reason=network");
  });
});
