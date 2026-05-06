import { describe, expect, it } from "vitest";
import {
  normalizeInstanceConnectToQrDataUrl,
  rawQrPayloadToDataUrl,
} from "@/lib/integrations/evolution-connect-qr";

const fakeB64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("rawQrPayloadToDataUrl", () => {
  it("wraps raw base64 as PNG data URL", () => {
    const out = rawQrPayloadToDataUrl(fakeB64);
    expect(out).toMatch(/^data:image\/png;base64,/);
  });

  it("preserves existing data URL", () => {
    const u = `data:image/png;base64,${fakeB64}`;
    expect(rawQrPayloadToDataUrl(u)).toBe(u);
  });

  it("returns null for Baileys pairing token without image", () => {
    expect(rawQrPayloadToDataUrl("2@short-not-image")).toBeNull();
  });
});

describe("normalizeInstanceConnectToQrDataUrl", () => {
  it("reads top-level code as base64 image", () => {
    const u = normalizeInstanceConnectToQrDataUrl({ code: fakeB64 });
    expect(u).toMatch(/^data:image\/png;base64,/);
  });

  it("reads base64 field", () => {
    const u = normalizeInstanceConnectToQrDataUrl({ base64: fakeB64 });
    expect(u).toMatch(/^data:image\/png;base64,/);
  });

  it("reads nested qrcode.base64", () => {
    const u = normalizeInstanceConnectToQrDataUrl({ qrcode: { base64: fakeB64 } });
    expect(u).toMatch(/^data:image\/png;base64,/);
  });

  it("unwraps data wrapper", () => {
    const u = normalizeInstanceConnectToQrDataUrl({ data: { base64: fakeB64 } });
    expect(u).toMatch(/^data:image\/png;base64,/);
  });

  it("prefers image over Baileys code when both present", () => {
    const u = normalizeInstanceConnectToQrDataUrl({
      code: "2@pairing-token-placeholder",
      base64: fakeB64,
    });
    expect(u).toMatch(/^data:image\/png;base64,/);
  });
});
