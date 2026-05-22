import { describe, expect, it } from "vitest";
import {
  buildWhatsappRemoteJid,
  extractLeadName,
  extractLeadPhone,
  isSameCalendarDayUtc,
  shouldSendMetaInitialOutreach,
} from "@/lib/server/meta-lead-processing";

describe("Meta webhook helpers", () => {
  it("parses common Lead Ads name and phone fields", () => {
    expect(
      extractLeadName({
        full_name: "Maria Silva",
        phone_number: "+55 (62) 99999-1234",
      }),
    ).toBe("Maria Silva");
    expect(
      extractLeadPhone({
        full_name: "Maria Silva",
        phone_number: "+55 (62) 99999-1234",
      }),
    ).toBe("5562999991234");
  });

  it("supports Portuguese custom fields for name and WhatsApp", () => {
    expect(
      extractLeadName({
        nome_completo: "João Teste",
        whatsapp: "(11) 98888-7777",
      }),
    ).toBe("João Teste");
    expect(
      extractLeadPhone({
        nome_completo: "João Teste",
        whatsapp: "(11) 98888-7777",
      }),
    ).toBe("5511988887777");
  });

  it("builds a WhatsApp remoteJid from the normalized phone", () => {
    expect(buildWhatsappRemoteJid("5562999991234")).toBe("5562999991234@s.whatsapp.net");
  });

  it("allows initial outreach for a new leadgen id even if phone had prior outreach", () => {
    expect(
      shouldSendMetaInitialOutreach(
        {
          meta_initial_outreach_leadgen_id: "lead-1",
          meta_initial_outreach_sent_at: "2026-05-22T12:00:00.000Z",
        },
        "lead-2",
      ),
    ).toEqual({ shouldSend: true, reason: "not_sent_yet" });
  });

  it("detects same UTC calendar day", () => {
    expect(isSameCalendarDayUtc("2026-05-22T08:00:00.000Z", "2026-05-22T20:00:00.000Z")).toBe(true);
    expect(isSameCalendarDayUtc("2026-05-22T08:00:00.000Z", "2026-05-23T01:00:00.000Z")).toBe(false);
  });
});
