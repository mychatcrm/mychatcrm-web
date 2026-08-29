/**
 * Acesso ao estado de manutenção via Supabase (substitui maintenance-store-fs.ts).
 */
import { createSupabaseServiceClient } from "@/lib/supabase/server";

const ROW_ID = "global";

type DbMaintenanceRow = {
  id: string;
  enabled: boolean;
  message: string;
  estimated_return_at: string | null;
  updated_at: string;
  updated_by_admin_id: string | null;
};

export type MaintenanceStateDb = {
  enabled: boolean;
  message: string;
  estimatedReturnAt?: string;
  updatedAt: string;
  updatedByAdminId?: string;
};

function dbToState(row: DbMaintenanceRow): MaintenanceStateDb {
  return {
    enabled: row.enabled,
    message: row.message,
    estimatedReturnAt: row.estimated_return_at ?? undefined,
    updatedAt: row.updated_at,
    updatedByAdminId: row.updated_by_admin_id ?? undefined,
  };
}

/** Public HTTP response backed by a server-only read; admin columns never leave the route. */
export async function readMaintenanceStatePublic(): Promise<MaintenanceStateDb> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("maintenance_mode")
    .select("*")
    .eq("id", ROW_ID)
    .single();
  if (error || !data) return { enabled: false, message: "", updatedAt: "" };
  return dbToState(data as DbMaintenanceRow);
}

/** Leitura privilegiada via service_role. */
export async function readMaintenanceState(): Promise<MaintenanceStateDb> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("maintenance_mode")
    .select("*")
    .eq("id", ROW_ID)
    .single();
  if (error || !data) return { enabled: false, message: "", updatedAt: "" };
  return dbToState(data as DbMaintenanceRow);
}

export async function writeMaintenanceState(
  state: Partial<MaintenanceStateDb>,
): Promise<void> {
  const sb = createSupabaseServiceClient();
  const { error } = await sb
    .from("maintenance_mode")
    .update({
      ...(state.enabled !== undefined && { enabled: state.enabled }),
      ...(state.message !== undefined && { message: state.message }),
      estimated_return_at: state.estimatedReturnAt ?? null,
      updated_at: new Date().toISOString(),
      updated_by_admin_id: state.updatedByAdminId ?? null,
    })
    .eq("id", ROW_ID);
  if (error) throw new Error(`[maintenance-store-db] write: ${error.message}`);
}
