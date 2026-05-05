import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, hasAdminAccess } from "@/lib/admin-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getAdminSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!hasAdminAccess(session, "seguranca")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("admin_security_config")
    .select("*")
    .eq("id", "global")
    .maybeSingle();

  if (error) {
    console.error("[admin/security-config] GET:", error.message);
    return NextResponse.json({ error: "Falha ao carregar configuração." }, { status: 500 });
  }

  const defaults = { ipWhitelistEnabled: false, blockOffHours: false };
  if (!data) return NextResponse.json(defaults, { headers: { "Cache-Control": "no-store" } });

  return NextResponse.json(
    {
      ipWhitelistEnabled: Boolean(data.ip_whitelist_enabled),
      blockOffHours: Boolean(data.block_off_hours),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PATCH(request: Request) {
  const session = await getAdminSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!hasAdminAccess(session, "seguranca")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Payload inválido." }, { status: 400 });
  }

  const updates: Record<string, unknown> = { id: "global", updated_at: new Date().toISOString() };
  if (typeof body.ipWhitelistEnabled === "boolean") updates.ip_whitelist_enabled = body.ipWhitelistEnabled;
  if (typeof body.blockOffHours === "boolean") updates.block_off_hours = body.blockOffHours;

  const sb = createSupabaseServiceClient();
  const { error } = await sb.from("admin_security_config").upsert(updates, { onConflict: "id" });

  if (error) {
    console.error("[admin/security-config] PATCH:", error.message);
    return NextResponse.json({ error: "Falha ao salvar configuração." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
