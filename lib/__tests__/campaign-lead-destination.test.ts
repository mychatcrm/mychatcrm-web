import { describe, expect, it } from "vitest";
import {
  buildCampaignLeadPatch,
  parseCampaignLeadDestination,
} from "@/lib/server/whatsapp-campaigns";

/**
 * Destino do lead ao entrar no disparo.
 *
 * A troca do agente de IA (leads.agent_id) sempre acontece — é a isolação do
 * agente de disparos, já em produção, e não é opção aqui. O que o dono da
 * conta pode escolher, por campanha, é só o funil/coluna e o vendedor
 * responsável. Sem configurar nada, o comportamento é o de sempre: nada muda
 * além do agente.
 */

const NOW = "2026-08-18T12:00:00.000Z";

describe("parseCampaignLeadDestination", () => {
  it("sem config devolve tudo desligado — não mexe em funil/coluna/dono", () => {
    for (const vazio of [null, undefined, {}]) {
      expect(parseCampaignLeadDestination(vazio)).toEqual({
        moveToFunnel: false,
        funnelId: null,
        columnId: null,
        releaseOwner: false,
      });
    }
  });

  it("moveToFunnel ligado sem funil ou sem coluna cai pra desligado", () => {
    expect(parseCampaignLeadDestination({ moveToFunnel: true }).moveToFunnel).toBe(false);
    expect(parseCampaignLeadDestination({ moveToFunnel: true, funnelId: "funil-1" }).moveToFunnel).toBe(false);
    expect(parseCampaignLeadDestination({ moveToFunnel: true, columnId: "col-1" }).moveToFunnel).toBe(false);
  });

  it("resolve o destino completo", () => {
    expect(
      parseCampaignLeadDestination({ moveToFunnel: true, funnelId: "funil-1", columnId: "col-1" }),
    ).toEqual({ moveToFunnel: true, funnelId: "funil-1", columnId: "col-1", releaseOwner: false });
  });

  it("releaseOwner é independente de moveToFunnel", () => {
    expect(parseCampaignLeadDestination({ releaseOwner: true })).toEqual({
      moveToFunnel: false,
      funnelId: null,
      columnId: null,
      releaseOwner: true,
    });
    expect(
      parseCampaignLeadDestination({
        moveToFunnel: true,
        funnelId: "funil-1",
        columnId: "col-1",
        releaseOwner: true,
      }),
    ).toEqual({ moveToFunnel: true, funnelId: "funil-1", columnId: "col-1", releaseOwner: true });
  });

  it("valor não-objeto nunca quebra — vem de jsonb do banco", () => {
    for (const bad of ["texto", 42, [], true]) {
      expect(parseCampaignLeadDestination(bad)).toEqual({
        moveToFunnel: false,
        funnelId: null,
        columnId: null,
        releaseOwner: false,
      });
    }
  });
});

describe("buildCampaignLeadPatch", () => {
  const campaignBase = { agent_id: "disparos-default" };

  it("sem lead_destination: só o agente muda — guarda de regressão do comportamento de hoje", () => {
    const patch = buildCampaignLeadPatch(campaignBase, NOW);
    expect(patch).toEqual({
      source: "whatsapp_campaign",
      agent_id: "disparos-default",
      agent_assignment_source: "whatsapp_campaign",
      last_message_at: NOW,
      last_seen: NOW,
      updated_at: NOW,
    });
    expect(patch.crm_funnel_id).toBeUndefined();
    expect(patch.status).toBeUndefined();
    expect(patch.owner_employee_id).toBeUndefined();
  });

  it("moveToFunnel ligado: grava funil e coluna (status é o id da coluna, mesmo padrão do resto do CRM)", () => {
    const patch = buildCampaignLeadPatch(
      { ...campaignBase, lead_destination: { moveToFunnel: true, funnelId: "funil-1", columnId: "col-1" } },
      NOW,
    );
    expect(patch.crm_funnel_id).toBe("funil-1");
    expect(patch.status).toBe("col-1");
    expect(patch.owner_employee_id).toBeUndefined();
  });

  it("releaseOwner ligado: zera owner_employee_id sem mexer em funil/coluna", () => {
    const patch = buildCampaignLeadPatch(
      { ...campaignBase, lead_destination: { releaseOwner: true } },
      NOW,
    );
    expect(patch.owner_employee_id).toBeNull();
    expect(patch.crm_funnel_id).toBeUndefined();
    expect(patch.status).toBeUndefined();
  });

  it("os dois ligados ao mesmo tempo", () => {
    const patch = buildCampaignLeadPatch(
      {
        ...campaignBase,
        lead_destination: { moveToFunnel: true, funnelId: "funil-1", columnId: "col-1", releaseOwner: true },
      },
      NOW,
    );
    expect(patch.crm_funnel_id).toBe("funil-1");
    expect(patch.status).toBe("col-1");
    expect(patch.owner_employee_id).toBeNull();
  });

  it("agent_id da campanha sempre vence — isolação não é opcional", () => {
    const patch = buildCampaignLeadPatch(
      { ...campaignBase, lead_destination: { moveToFunnel: false, releaseOwner: false } },
      NOW,
    );
    expect(patch.agent_id).toBe("disparos-default");
    expect(patch.agent_assignment_source).toBe("whatsapp_campaign");
  });
});
