import { describe, expect, it } from "vitest";
import {
  buildWhatsappRemoteJid,
  extractLeadName,
  extractLeadPhone,
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

  it("prevents duplicate initial outreach for the same Meta leadgen id", () => {
    expect(
      shouldSendMetaInitialOutreach(
        {
          meta_initial_outreach_leadgen_id: "lead-1",
          meta_initial_outreach_sent_at: "2026-05-22T12:00:00.000Z",
        },
        "lead-1",
      ),
    ).toEqual({ shouldSend: false, reason: "same_leadgen_already_sent" });
  });

  it("prevents duplicate initial outreach after any previous initial outreach", () => {
    expect(
      shouldSendMetaInitialOutreach(
        {
          meta_initial_outreach_leadgen_id: "lead-1",
          meta_initial_outreach_sent_at: "2026-05-22T12:00:00.000Z",
        },
        "lead-2",
      ),
    ).toEqual({ shouldSend: false, reason: "initial_outreach_already_sent" });
  });
});
