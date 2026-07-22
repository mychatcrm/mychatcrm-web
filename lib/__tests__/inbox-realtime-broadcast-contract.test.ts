import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("secure inbox realtime contract", () => {
  it("broadcasts only an opaque message id on a tenant capability topic", () => {
    const migration = source(
      "supabase/migrations/20260722201158_secure_inbox_realtime_broadcast.sql",
    );

    expect(migration).toContain("CREATE TABLE IF NOT EXISTS private.inbox_realtime_topics");
    expect(migration).toContain("extensions.gen_random_bytes(32)");
    expect(migration).toContain("'messageId', NEW.id::text");
    expect(migration).toContain("'operation', lower(TG_OP)");
    expect(migration).toContain("'message_changed'");
    expect(migration).toMatch(/'inbox:'\s*\|\|\s*v_topic,\s*false/s);

    const payload = migration.slice(
      migration.indexOf("jsonb_build_object("),
      migration.indexOf("'message_changed'"),
    );
    expect(payload).not.toMatch(/phone|content|tenant|media|remote_jid/i);
  });

  it("cannot expose the table and cannot roll back persistence on broadcast failure", () => {
    const migration = source(
      "supabase/migrations/20260722201158_secure_inbox_realtime_broadcast.sql",
    );

    expect(migration).toContain("REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("REVOKE ALL ON private.inbox_realtime_topics FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("EXCEPTION WHEN OTHERS THEN");
    expect(migration).toContain('DROP POLICY IF EXISTS "anon realtime read"');
    expect(migration).not.toMatch(/GRANT\s+SELECT\s+ON\s+(public\.)?whatsapp_messages\s+TO\s+(anon|authenticated)/i);
  });

  it("hydrates IDs only through the authenticated tenant-scoped endpoint", () => {
    const route = source("app/api/client/conversas/realtime/route.ts");

    expect(route).toContain("getClientSessionFromCookies");
    expect(route).toContain(".slice(0, 50)");
    expect(route).toContain('.eq("tenant_id", session.tenantId)');
    expect(route).toContain('.in("id", ids)');
    expect(route).toContain('"Cache-Control": "private, no-store, max-age=0"');
  });

  it("persists inbound messages before journey and lead enrichment", () => {
    const evolution = source("app/api/webhooks/evolution/route.ts");
    const evolutionPhase = evolution.slice(
      evolution.indexOf("// ── Phase 1: save all messages"),
      evolution.indexOf("// ── Phase 2: run automation flows"),
    );
    expect(evolutionPhase.indexOf("await saveMessage({")).toBeGreaterThan(-1);
    expect(evolutionPhase.indexOf("await saveMessage({")).toBeLessThan(
      evolutionPhase.indexOf("resolveDirectJourneyAgent({"),
    );
    expect(evolutionPhase).toContain("if (!inboundSaved)");
    expect(evolutionPhase).toContain("inbound_attribution_failed");

    const meta = source("lib/server/whatsapp-cloud-webhook-handler.ts");
    const inboundHandler = meta.slice(meta.indexOf("const phone = inbound.fromWaId"));
    expect(inboundHandler.indexOf('.from("whatsapp_messages")')).toBeLessThan(
      inboundHandler.indexOf("resolveDirectJourneyAgent({"),
    );
    expect(inboundHandler).toContain("inbound_attribution_failed");
  });

  it("uses one tenant-wide subscription with batched authenticated hydration", () => {
    const dashboard = source("components/dashboard/conversas/AtendimentoV2.tsx");

    expect(dashboard).toContain("subscribeToInboxBroadcast({");
    expect(dashboard).toContain("const pending = new Map<string, InboxBroadcastOperation>()");
    expect(dashboard).toContain("const seenMessageIds = new Set<string>()");
    expect(dashboard).toContain("const scheduleFlush = (delay = 16)");
    expect(dashboard).toContain("apiHydrateRealtimeMessages(batch.map(([id]) => id))");
    expect(dashboard).toContain("scheduleReconnect");
    expect(dashboard).toContain('document.addEventListener("visibilitychange"');
  });
});
