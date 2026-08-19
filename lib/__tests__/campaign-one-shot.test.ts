import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Disparo "único": manda a mensagem e não continua a conversa pela IA.
 *
 * `pauseConversationAfterCampaignSend` espelha `pauseConversationForLeadOutcome`
 * (mesmo mecanismo de pausa, já testado em conversation-operation.ts) — o que
 * este arquivo garante é a fiação: que `processRecipient` chama a pausa DEPOIS
 * do upsert que grava agent_id/journey, e só quando a campanha pediu.
 */

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("contrato: disparo único pausa a automação depois do envio", () => {
  const campaigns = source("lib/server/whatsapp-campaigns.ts");
  const conversationOperation = source("lib/server/conversation-operation.ts");

  it("pauseConversationAfterCampaignSend existe e usa o mesmo mecanismo de pausa (RPC, não update cru)", () => {
    expect(conversationOperation).toContain("export async function pauseConversationAfterCampaignSend");
    expect(conversationOperation).toContain("CAMPAIGN_ONE_SHOT_PAUSED_BY");
    expect(conversationOperation).toContain('pausedReason: "campaign_one_shot"');
    expect(conversationOperation).toContain("pausedBy: CAMPAIGN_ONE_SHOT_PAUSED_BY");
    expect(conversationOperation).toContain('mode: "human"');
  });

  it("processRecipient só pausa quando continue_with_agent é false", () => {
    expect(campaigns).toContain("params.campaign.continue_with_agent === false");
    expect(campaigns).toContain("pauseConversationAfterCampaignSend(");
  });

  it("a pausa acontece DEPOIS do upsert que grava agent_id/journey em conversation_states", () => {
    // A RPC faz upsert e não sobrescreve active_journey_id/last_message_at —
    // mas só se o upsert direto já rodou antes. Rodar antes seria inofensivo
    // hoje, mas inverteria a garantia que o comentário do código documenta.
    const upsertIdx = campaigns.indexOf('.from("conversation_states")\n      .upsert(');
    const pauseIdx = campaigns.indexOf("pauseConversationAfterCampaignSend(");
    expect(upsertIdx).toBeGreaterThan(-1);
    expect(pauseIdx).toBeGreaterThan(upsertIdx);
  });

  it("a migration da coluna existe, com default true (não muda campanha existente)", () => {
    const migrationFiles = ["supabase/migrations/20260819120000_whatsapp_campaigns_continue_with_agent.sql"];
    for (const path of migrationFiles) {
      const sql = source(path);
      expect(sql).toContain("continue_with_agent boolean not null default true");
    }
  });
});
