import { describe, expect, it } from "vitest";
import { phoneFromRemoteJid } from "@/lib/server/auto-lead-upsert";

describe("phoneFromRemoteJid", () => {
  it("extracts only digits from WhatsApp remoteJid", () => {
    expect(phoneFromRemoteJid("55 11 99999-0000@s.whatsapp.net")).toBe("5511999990000");
  });

  it("returns an empty string for empty input", () => {
    expect(phoneFromRemoteJid("")).toBe("");
  });
});
