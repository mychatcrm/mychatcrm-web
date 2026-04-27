import type { ClientSession } from "@/lib/client-auth";
import { getDashboardDataset, type DashboardDataset } from "@/lib/dashboard-data";

export async function loadDashboardDataset(session: ClientSession): Promise<DashboardDataset> {
  return getDashboardDataset(session);
}
