import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, hasAdminAccess } from "@/lib/admin-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { AdminRole } from "@/lib/admin-permissions";
import { randomBytes, createHash } from "node:crypto";

const ROLE_LABEL: Record<AdminRole, string> = {
  super_admin: "Super Admin",
  admin: "Administrador",
  financeiro: "Financeiro",
  suporte: "Suporte",
  marketing: "Marketing",
  desenvolvedor: "Desenvolvedor",
};

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getAdminSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!hasAdminAccess(session, "equipe")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("admin_users")
    .select("id,email,display_name,initials,role,active,created_at,password_changed_at")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[admin/team] GET:", error.message);
    return NextResponse.json({ error: "Falha ao carregar equipe." }, { status: 500 });
  }

  const members = (data ?? []).map((row) => ({
    id: row.id as string,
    email: row.email as string,
    displayName: row.display_name as string,
    initials: row.initials as string,
    role: row.role as AdminRole,
    roleLabel: ROLE_LABEL[row.role as AdminRole] ?? String(row.role),
    active: row.active as boolean,
    createdAt: row.created_at as string,
    lastActivity: row.password_changed_at as string | null,
  }));

  return NextResponse.json({ members }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const session = await getAdminSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (session.role !== "super_admin") {
    return NextResponse.json({ error: "Apenas super admin pode convidar membros." }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Payload inválido." }, { status: 400 });
  }

  const email = String(body.email ?? "").trim().toLowerCase();
  const displayName = String(body.displayName ?? "").trim();
  const role = String(body.role ?? "") as AdminRole;
  const validRoles: AdminRole[] = ["admin", "financeiro", "suporte", "marketing", "desenvolvedor"];

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Email inválido." }, { status: 400 });
  }
  if (!displayName) {
    return NextResponse.json({ error: "Nome obrigatório." }, { status: 400 });
  }
  if (!validRoles.includes(role)) {
    return NextResponse.json({ error: "Role inválido." }, { status: 400 });
  }

  const initials = displayName
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  const tempPassword = randomBytes(12).toString("base64url");
  const passwordHash = createHash("sha256").update(tempPassword).digest("hex");

  const sb = createSupabaseServiceClient();

  const { data: existing } = await sb
    .from("admin_users")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ error: "Email já cadastrado na equipe." }, { status: 409 });
  }

  const { data: created, error: insertErr } = await sb
    .from("admin_users")
    .insert({
      email,
      display_name: displayName,
      initials,
      role,
      active: true,
      password_hash: passwordHash,
    })
    .select("id")
    .single();

  if (insertErr || !created) {
    console.error("[admin/team] POST insert:", insertErr?.message);
    return NextResponse.json({ error: "Falha ao criar membro. Verifique se o email já existe." }, { status: 500 });
  }

  return NextResponse.json({
    message: "Membro criado. Senha temporária gerada (envie por canal seguro).",
    id: created.id,
    tempPassword,
  });
}
