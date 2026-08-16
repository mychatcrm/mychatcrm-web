import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCampaignSendWindow } from "@/lib/server/whatsapp-campaigns";
import { isWithinBusinessHours } from "@/lib/server/follow-up-engine";

/**
 * Janela de envio do disparo.
 *
 * Antes disto o disparo saía sempre que o processador acordasse — e quem
 * acordava era o cron de follow-up, 1×/dia às 4h da manhã. O cliente não tinha
 * como dizer "só em horário comercial" nem "só na terça", e uma lista de mil
 * pessoas levava ~13 dias.
 *
 * O formato espelha o do follow-up de propósito, para reusar
 * `isWithinBusinessHours` em vez de manter dois avaliadores de janela que
 * divergiriam com o tempo.
 */

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const JANELA_COMERCIAL = {
  ativo: true,
  diasAtivos: [1, 2, 3, 4, 5],
  horaInicio: 9,
  minutoInicio: 0,
  horaFim: 18,
  minutoFim: 0,
  timezone: "America/Sao_Paulo",
};

describe("parseCampaignSendWindow", () => {
  it("sem janela configurada devolve null — envia a qualquer hora, como sempre", () => {
    // Campanha antiga não pode parar de enviar por causa desta feature.
    for (const vazio of [null, undefined, {}, { ativo: false }]) {
      expect(parseCampaignSendWindow(vazio)).toBeNull();
    }
  });

  it("janela ligada sem nenhum dia marcado devolve null", () => {
    // Uma janela que nunca abre travaria a campanha para sempre, em silêncio.
    // Pior que não ter janela: o cliente não entenderia por que nada sai.
    expect(parseCampaignSendWindow({ ...JANELA_COMERCIAL, diasAtivos: [] })).toBeNull();
  });

  it("resolve a janela completa", () => {
    expect(parseCampaignSendWindow(JANELA_COMERCIAL)).toEqual(JANELA_COMERCIAL);
  });

  it("descarta dia inválido e remove repetido", () => {
    const parsed = parseCampaignSendWindow({ ...JANELA_COMERCIAL, diasAtivos: [1, 1, 9, -2, 6] });
    expect(parsed?.diasAtivos).toEqual([1, 6]);
  });

  it("hora fora da faixa cai no padrão em vez de gerar janela impossível", () => {
    const parsed = parseCampaignSendWindow({
      ...JANELA_COMERCIAL,
      horaInicio: 99,
      horaFim: -3,
      minutoInicio: 250,
    });
    expect(parsed?.horaInicio).toBe(23);
    expect(parsed?.horaFim).toBe(0);
    expect(parsed?.minutoInicio).toBe(59);
  });

  it("valor não-objeto nunca quebra — vem de jsonb do banco", () => {
    for (const bad of ["texto", 42, [], true]) {
      expect(parseCampaignSendWindow(bad)).toBeNull();
    }
  });
});

describe("a janela decide o envio", () => {
  // Quarta-feira, 14h em São Paulo.
  const dentro = new Date("2026-08-12T17:00:00Z");
  // Quarta-feira, 3h da manhã em São Paulo.
  const foraPorHora = new Date("2026-08-12T06:00:00Z");
  // Sábado, 14h em São Paulo.
  const foraPorDia = new Date("2026-08-15T17:00:00Z");

  it("envia dentro da janela", () => {
    expect(isWithinBusinessHours(dentro, JANELA_COMERCIAL)).toBe(true);
  });

  it("não envia de madrugada", () => {
    expect(isWithinBusinessHours(foraPorHora, JANELA_COMERCIAL)).toBe(false);
  });

  it("não envia em dia não marcado", () => {
    expect(isWithinBusinessHours(foraPorDia, JANELA_COMERCIAL)).toBe(false);
  });
});

describe("contrato: janela e cron", () => {
  const campaigns = source("lib/server/whatsapp-campaigns.ts");

  it("a janela é avaliada ANTES de resolver a conexão", () => {
    // No transporte Cloud, resolver a conexão custa idas ao Graph. Pagar por
    // elas para descobrir em seguida que está fora da janela é desperdício.
    const janela = campaigns.indexOf("parseCampaignSendWindow(campaign.send_window)");
    const conexao = campaigns.indexOf("lookupWhatsAppCloudConnectionByPhoneNumberId(String(campaign.connection_id))");
    expect(janela).toBeGreaterThan(-1);
    expect(conexao).toBeGreaterThan(janela);
  });

  it("fora da janela a campanha é pulada, não marcada como falha", () => {
    // Marcar `failed` mataria a campanha de vez; ela só precisa esperar.
    expect(campaigns).toContain("outside_send_window");
  });

  it("reusa o avaliador do follow-up em vez de duplicar a regra", () => {
    expect(campaigns).toContain('import { isWithinBusinessHours } from "@/lib/server/follow-up-engine"');
  });

  it("disparos têm cron próprio, de hora em hora", () => {
    // Sai de carona no process-follow-ups (1×/dia): um disparo travado
    // atrasava o follow-up e vice-versa.
    const vercel = JSON.parse(source("vercel.json")) as {
      crons: Array<{ path: string; schedule: string }>;
    };
    const omni = vercel.crons.find((c) => c.path === "/api/internal/process-omnichannel");
    expect(omni).toBeDefined();
    expect(omni?.schedule).toBe("0 * * * *");
  });

  it("a rota do cron realmente processa campanhas", () => {
    expect(source("app/api/internal/process-omnichannel/route.ts")).toContain(
      "processDueWhatsAppCampaigns",
    );
  });
});
