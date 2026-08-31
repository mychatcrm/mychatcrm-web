import type { AdminRole } from "@/lib/admin-permissions";

export const OPERATIONAL_AUDIT_OWNER_ADMIN_ID = "admin-renato-lagares";

export function isOperationalAuditOwnerIdentity(session: { adminId: string; role: AdminRole }): boolean {
  return session.role === "super_admin"
    && session.adminId === OPERATIONAL_AUDIT_OWNER_ADMIN_ID;
}
