import { describe, expect, it } from "vitest";
import {
  humanizeNotificationError,
  notificationProvider,
  notificationProviderBadge,
} from "@/lib/client/system-agent-notifications";

describe("humanizeNotificationError — Meta error codes", () => {
  it("translates 131047 (24h window) into an actionable message", () => {
    const msg = humanizeNotificationError("meta_status:failed:131047:Re-engagement message", "meta_cloud");
    expect(msg).toContain("janela de 24h");
    expect(msg).toContain("template");
  });

  it("translates 190 (expired token) into a reconnect instruction", () => {
    const msg = humanizeNotificationError("meta_status:failed:190:Access token has expired", "meta_cloud");
    expect(msg).toContain("Token");
    expect(msg).toContain("Reconecte");
  });

  it("falls back to showing the raw code + title for unknown Meta codes", () => {
    const msg = humanizeNotificationError("meta_status:failed:999999:Something odd", "meta_cloud");
    expect(msg).toContain("999999");
    expect(msg).toContain("Something odd");
  });

  it("keeps the plain meta_status:failed behavior when no code is present", () => {
    const msg = humanizeNotificationError("meta_status:failed", "meta_cloud");
    expect(msg).toBeTruthy();
  });
});

describe("notificationProvider / badge", () => {
  it("detects meta_cloud provider from metadata", () => {
    expect(notificationProvider({ provider: "meta_cloud" })).toBe("meta_cloud");
    expect(notificationProviderBadge("meta_cloud")).toMatchObject({ label: "API Meta" });
  });

  it("detects evolution provider from instance_name", () => {
    expect(notificationProvider({ instance_name: "mc049357abc" })).toBe("evolution");
    expect(notificationProviderBadge("evolution")).toMatchObject({ label: "QR Code" });
  });

  it("returns null for unknown metadata", () => {
    expect(notificationProvider(null)).toBeNull();
    expect(notificationProviderBadge(null)).toBeNull();
  });
});
