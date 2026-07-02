import { describe, expect, it } from "vitest";
import {
  leadMatchesWhatsAppCampaignAudience,
  renderWhatsAppCampaignTemplate,
} from "@/lib/server/whatsapp-campaigns";

describe("WhatsApp campaign helpers", () => {
  const lead = {
    name: "Maria",
    phone: "+55 (62) 99999-1111",
    status: "contato",
    profile_metadata: {
      empresa: "Clínica Centro",
      tags: ["Paciente", "Retorno"],
    },
  };

  it("renders only the documented lead variables", () => {
    expect(
      renderWhatsAppCampaignTemplate(
        "Olá {{nome}} da {{empresa}}. Seu telefone é {{telefone}}.",
        lead,
      ),
    ).toBe("Olá Maria da Clínica Centro. Seu telefone é 5562999991111.");
  });

  it("matches complete, tag and funnel-stage audiences deterministically", () => {
    expect(leadMatchesWhatsAppCampaignAudience(lead, "all", null)).toBe(true);
    expect(leadMatchesWhatsAppCampaignAudience(lead, "tag", "paciente")).toBe(true);
    expect(leadMatchesWhatsAppCampaignAudience(lead, "tag", "outro")).toBe(false);
    expect(leadMatchesWhatsAppCampaignAudience(lead, "funnel_stage", "contato")).toBe(true);
    expect(leadMatchesWhatsAppCampaignAudience(lead, "funnel_stage", "novo")).toBe(false);
  });
});
