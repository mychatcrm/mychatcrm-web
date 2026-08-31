import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { normalizeConversationBurst } from "@/lib/conversas/normalize-conversation-burst";
import { evolutionWebhookEventKey } from "@/lib/server/evolution-webhook-inbox";

describe("certificação sintética de isolamento e idempotência", () => {
  it("mantém 100 agentes isolados numa conexão durante 10.000 eventos", () => {
    const connectionId = "controlled-connection";
    const ownerByConversation = new Map<string, string>();
    const eventKeys = new Set<string>();

    for (let index = 0; index < 10_000; index += 1) {
      const agentId = `agent-${index % 100}`;
      const remoteJid = `contact-${index % 1_000}@s.whatsapp.net`;
      const conversationKey = `tenant-canary:${remoteJid}:${connectionId}`;
      const currentOwner = ownerByConversation.get(conversationKey);
      if (!currentOwner) ownerByConversation.set(conversationKey, agentId);

      const payload = {
        event: "messages.upsert",
        instance: connectionId,
        data: { key: { id: `provider-${index}`, remoteJid }, message: { conversation: `message-${index}` } },
      };
      const eventKey = evolutionWebhookEventKey(payload);
      expect(eventKeys.has(eventKey)).toBe(false);
      eventKeys.add(eventKey);

      const burst = normalizeConversationBurst([
        { id: `${agentId}-${index}-a`, content: `message-${index}` },
        { id: `${agentId}-${index}-b`, content: ` MESSAGE-${index} ` },
      ]);
      expect(burst.replyUnits).toHaveLength(1);
      expect(burst.dedupedCount).toBe(1);
    }

    expect(eventKeys.size).toBe(10_000);
    expect(new Set(ownerByConversation.values()).size).toBe(100);
  });

  it("colapsa 1.000 webhooks duplicados e fora de ordem sem colisão de conteúdo", () => {
    const originals = Array.from({ length: 1_000 }, (_, index) => ({
      event: "messages.upsert",
      instance: "controlled-connection",
      data: { key: { id: `provider-${index}`, remoteJid: `contact-${index}@s.whatsapp.net` } },
    }));
    const delivery = [...originals].reverse().flatMap((payload) => [payload, structuredClone(payload)]);
    const keys = delivery.map(evolutionWebhookEventKey);
    expect(keys).toHaveLength(2_000);
    expect(new Set(keys).size).toBe(1_000);
  });

  it("mantém no banco uma única jornada ativa por contato e um job por canal/conexão", () => {
    const journeys = readFileSync(
      join(process.cwd(), "supabase/migrations/20260702011138_omnichannel_lead_journeys_campaigns.sql"),
      "utf8",
    );
    const jobs = readFileSync(
      join(process.cwd(), "supabase/migrations/20260716140346_agent_pipeline_v2_durable_turns.sql"),
      "utf8",
    );
    expect(journeys).toMatch(
      /unique index if not exists lead_journeys_one_active_per_contact_idx[\s\S]*\(tenant_id, remote_jid\)[\s\S]*status = 'active'/,
    );
    expect(jobs).toContain("agent_response_jobs_open_channel_unique_idx");
    expect(jobs).toContain("tenant_id,\n    remote_jid,\n    channel,");
    expect(jobs).toContain("COALESCE(connection_id, '')");
  });
});
