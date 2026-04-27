import type { AdminSession } from "@/lib/admin-auth";
import { getAdminDataset, type AdminDataset } from "@/lib/admin-data";

export async function loadAdminDataset(session: AdminSession): Promise<AdminDataset> {
  return getAdminDataset(session);
}
