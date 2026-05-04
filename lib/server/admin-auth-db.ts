/**
 * Autenticação de admins via Supabase (substitui env var DEMO_ADMIN_PASSWORD).
 */
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { AdminRole, AdminSession } from "@/lib/admin-auth";

type DbAdmin = {
  id: string;
  email: string;
  display_name: string;
  initials: string;
  role: AdminRole;
  active: boolean;
};

const ROLE_LABEL: Record<AdminRole, string> = {
  super_admin: "Super Admin",
  admin: "Administrador",
  financeiro: "Financeiro",
  suporte: "Suporte",
  marketing: "Marketing",
  desenvolvedor: "Desenvolvedor",
};

function dbToSession(row: DbAdmin): AdminSession {
  return {
    token: row.id,
    adminId: row.id,
    email: row.email,
    displayName: row.display_name,
    initials: row.initials,
    role: row.role,
    roleLabel: ROLE_LABEL[row.role] ?? row.role,
  };
}

export async function authenticateAdminFromDb(
  emailRaw: string,
  password: string,
): Promise<AdminSession | null> {
  const email = emailRaw.trim().toLowerCase();
  if (!email || !password.trim()) return null;

  const sb = createSupabaseServiceClient();

  // Uses SECURITY DEFINER RPC — bypasses RLS regardless of API key format.
  const { data: rows, error } = await sb.rpc("get_admin_by_email", { p_email: email });

  if (error) {
    console.error("[admin-auth-db] get_admin_by_email:", error.message);
    return null;
  }
  const admin = Array.isArray(rows) ? (rows[0] as DbAdmin | undefined) : null;
  if (!admin) return null;

  const { data: ok, error: verifyErr } = await sb.rpc("verify_admin_password", {
    admin_id: admin.id,
    plain_password: password.trim(),
  });

  if (verifyErr) {
    console.error("[admin-auth-db] verify_admin_password:", verifyErr.message);
  }
  if (verifyErr || !ok) return null;

  return dbToSession(admin);
}

export async function getAdminSessionByIdFromDb(adminId: string): Promise<AdminSession | null> {
  if (!adminId) return null;
  const sb = createSupabaseServiceClient();

  // Uses SECURITY DEFINER RPC — bypasses RLS regardless of API key format.
  const { data: rows, error } = await sb.rpc("get_admin_by_id", { p_id: adminId });
  if (error) {
    console.error("[admin-auth-db] get_admin_by_id:", error.message);
    return null;
  }
  const data = Array.isArray(rows) ? (rows[0] as DbAdmin | undefined) : null;
  if (!data) return null;
  return dbToSession(data);
}
