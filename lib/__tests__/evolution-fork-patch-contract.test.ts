import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const patch = readFileSync(
  join(process.cwd(), "ops/evolution/patches/2.3.7-lid-alias-v3.patch"),
  "utf8",
);

describe("Evolution LID alias patch", () => {
  it("keeps the provider LID while canonicalizing chats from remoteJidAlt", () => {
    expect(patch).toContain("const providerRemoteJid = received.key.remoteJid");
    expect(patch).toContain("resolveCanonicalChatRemoteJid(received.key)");
    expect(patch).toContain("remoteJidAlt: providerRemoteJid");
    expect(patch).not.toContain("received.key.remoteJid = canonicalChatRemoteJid");
  });

  it("searches both supplied aliases against both stored key fields", () => {
    expect(patch).toContain("const identityJids = [keyFilters?.remoteJid, keyFilters?.remoteJidAlt]");
    expect(patch).toContain("path: ['remoteJid'], equals: jid");
    expect(patch).toContain("path: ['remoteJidAlt'], equals: jid");
  });

  it("contains no country, language, niche, prompt, or agenda specialization", () => {
    for (const forbidden of [
      "startsWith('55')",
      "imobili",
      "corretor",
      "restaurante",
      "healthcare",
      "prompt",
      "agenda",
    ]) {
      expect(patch.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});
