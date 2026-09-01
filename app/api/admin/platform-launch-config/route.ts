import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { getAdminSessionFromCookies, hasAdminAccess } from "@/lib/admin-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { PRE_LAUNCH_POPUP_CACHE_TAG } from "@/lib/server/pre-launch-config-db";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getAdminSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!hasAdminAccess(session, "leads-lancamento")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("platform_launch_config")
    .select("pre_launch_popup_enabled")
    .eq("id", "global")
    .maybeSingle();

  if (error) {
    console.error("[admin/platform-launch-config] GET:", error.message);
    return NextResponse.json({ error: "Falha ao carregar configuração." }, { status: 500 });
  }

  return NextResponse.json(
    { enabled: data ? data.pre_launch_popup_enabled !== false : true },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PATCH(request: Request) {
  const session = await getAdminSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!hasAdminAccess(session, "leads-lancamento")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({})) as { enabled?: unknown };
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "Campo 'enabled' obrigatório." }, { status: 400 });
  }

  const sb = createSupabaseServiceClient();
  const { error } = await sb.from("platform_launch_config").upsert(
    { id: "global", pre_launch_popup_enabled: body.enabled, updated_at: new Date().toISOString() },
    { onConflict: "id" },
  );

  if (error) {
    console.error("[admin/platform-launch-config] PATCH:", error.message);
    return NextResponse.json({ error: "Falha ao salvar configuração." }, { status: 500 });
  }

  // Efeito na hora nas páginas públicas estáticas, em vez de esperar os 30s do cache.
  revalidateTag(PRE_LAUNCH_POPUP_CACHE_TAG);

  return NextResponse.json({ ok: true });
}
