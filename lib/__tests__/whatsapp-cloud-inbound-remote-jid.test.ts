import { describe, expect, it } from "vitest";
import { buildWhatsappRemoteJid } from "@/lib/server/meta-lead-processing";

describe("Cloud inbound remote_jid parity with Lead Ads journeys", () => {
  it("normalizes Meta wa_id digits to the same remote_jid Lead Ads stores", () => {
    const metaWaId = "5511999990000";
    const leadAdsRemoteJid = buildWhatsappRemoteJid(metaWaId);
    // Handler must use this form — raw wa_id alone would miss the active journey.
    expect(leadAdsRemoteJid).toBe("5511999990000@s.whatsapp.net");
    expect(buildWhatsappRemoteJid(metaWaId.replace(/\D/g, ""))).toBe(leadAdsRemoteJid);
  });
});
