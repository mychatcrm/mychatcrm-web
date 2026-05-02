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
  const { data: admin, error } = await sb
    .from("admin_users")
    .select("id, email, display_name, initials, role, active")
    .eq("email", email)
    .eq("active", true)
    .single();

  if (error || !admin) return null;

  const row = admin as DbAdmin;
  const { data: ok, error: verifyErr } = await sb.rpc("verify_admin_password", {
    admin_id: row.id,
    plain_password: password.trim(),
  });

  if (verifyErr || !ok) return null;

  return dbToSession(row);
}

export async function getAdminSessionByIdFromDb(adminId: string): Promise<AdminSession | null> {
  if (!adminId) return null;
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("admin_users")
    .select("id, email, display_name, initials, role, active")
    .eq("id", adminId)
    .eq("active", true)
    .single();
  if (error || !data) return null;
  return dbToSession(data as DbAdmin);
}
