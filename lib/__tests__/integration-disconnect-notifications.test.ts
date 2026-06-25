import { describe, expect, it } from "vitest";

import {
  buildIntegrationDisconnectedMessage,
  isDisconnectedConnectionState,
  isStableDisconnectState,
  loadTenantNotificationRecipient,
  normalizeConnectionState,
  notifyTenantIntegrationDisconnected,
  shouldNotifyWhatsappDisconnect,
} from "@/lib/server/integration-disconnect-notifications";
import { SYSTEM_TENANT_ID } from "@/lib/server/system-agent";

describe("integration disconnect notifications", () => {
  it("normalizes Evolution connection states", () => {
    expect(normalizeConnectionState(" OPEN ")).toBe("open");
    expect(normalizeConnectionState(null)).toBe("");
  });

  it("detects disconnected states without treating open as disconnected", () => {
    expect(isDisconnectedConnectionState("open")).toBe(false);
    expect(isDisconnectedConnectionState("connecting")).toBe(true);
    expect(isDisconnectedConnectionState("close")).toBe(true);
    expect(isDisconnectedConnectionState("deleted")).toBe(true);
  });

  it("treats only stable disconnect states as alert-worthy", () => {
    expect(isStableDisconnectState("close")).toBe(true);
    expect(isStableDisconnectState("refused")).toBe(true);
    expect(isStableDisconnectState("deleted")).toBe(true);
    expect(isStableDisconnectState("logout")).toBe(true);
    expect(isStableDisconnectState("connecting")).toBe(false);
    expect(isStableDisconnectState("open")).toBe(false);
  });

  it("only notifies WhatsApp transition from open to stable disconnect", () => {
    expect(shouldNotifyWhatsappDisconnect({ previousState: "open", nextState: "close" })).toBe(true);
    expect(shouldNotifyWhatsappDisconnect({ previousState: "open", nextState: "refused" })).toBe(true);
    expect(shouldNotifyWhatsappDisconnect({ previousState: "open", nextState: "connecting" })).toBe(false);
    expect(shouldNotifyWhatsappDisconnect({ previousState: "close", nextState: "connecting" })).toBe(false);
    expect(shouldNotifyWhatsappDisconnect({ previousState: "open", nextState: "open" })).toBe(false);
  });

  it("builds clear system-agent messages for WhatsApp and Facebook", () => {
    const whatsapp = buildIntegrationDisconnectedMessage({
      integration: "whatsapp",
      tenantName: "My Broker Office",
      ownerName: "Renato",
      state: "close",
    });
    expect(whatsapp).toContain("WhatsApp");
    expect(whatsapp).toContain("My Broker Office");
    expect(whatsapp).toContain("reconecte a linha");

    const facebook = buildIntegrationDisconnectedMessage({
      integration: "facebook",
      tenantName: "My Broker Office",
      pageName: "Renato Lagares",
      manual: true,
    });
    expect(facebook).toContain("Meta/Facebook");
    expect(facebook).toContain("Renato Lagares");
    expect(facebook).toContain("Meta Lead Ads");
  });

  it("uses the dedicated system notification phone before owner/member fallbacks", async () => {
    const queriedTables: string[] = [];
    const sb = {
      from(table: string) {
        queriedTables.push(table);
        const builder = {
          select: () => builder,
          eq: () => builder,
          not: () => builder,
          limit: () => builder,
          maybeSingle: async () => {
            if (table === "tenants") {
              return {
                data: {
                  name: "My Broker Office",
                  system_notification_phone: "5562999991111",
                },
              };
            }
            if (table === "enterprise_provisions") {
              return {
                data: {
                  owner_member_id: "member-owner",
                  owner_email: "owner@example.com",
                  owner_name: "Renato",
                  organization_name: "My Broker Office",
                },
              };
            }
            return { data: { phone: "5562000000000" } };
          },
        };
        return builder;
      },
    };

    const recipient = await loadTenantNotificationRecipient({
      sb: sb as never,
      tenantId: "tenant-1",
    });

    expect(recipient.phone).toBe("5562999991111");
    expect(recipient.source).toBe("tenant_system_notification_phone");
    expect(queriedTables).not.toContain("tenant_members");
  });

  it("skips integration disconnect notifications for the internal system tenant", async () => {
    const result = await notifyTenantIntegrationDisconnected({
      tenantId: SYSTEM_TENANT_ID,
      integration: "whatsapp",
      source: "test",
      instanceName: "system-instance",
      state: "close",
      previousState: "open",
    });

    expect(result).toEqual({ ok: true, skipped: "system_tenant" });
  });
});
