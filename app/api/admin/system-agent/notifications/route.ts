import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, hasAdminAccess } from "@/lib/admin-auth";
import { reconcileOrphanDeliveryEvents, reconcileUndeliveredNotifications } from "@/lib/server/system-agent";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const SELECT = "id, type, to_number, message, status, error, metadata, created_at";

type Filters = {
  type: string | null;
  status: string | null;
  q: string | null;
  from: string | null;
  to: string | null;
};

function readFilters(url: URL): Filters {
  const get = (k: string) => {
    const v = url.searchParams.get(k);
    return v && v.trim() ? v.trim() : null;
  };
  return { type: get("type"), status: get("status"), q: get("q"), from: get("from"), to: get("to") };
}

// Aplica os mesmos filtros tanto no GET (select) quanto no DELETE.
function applyFilters<T extends { eq: (c: string, v: unknown) => T; gte: (c: string, v: unknown) => T; lte: (c: string, v: unknown) => T; or: (s: string) => T }>(
  query: T,
  f: Filters,
): T {
  let q = query;
  if (f.type) q = q.eq("type", f.type);
  if (f.status) q = q.eq("status", f.status);
  if (f.from) q = q.gte("created_at", f.from);
  if (f.to) q = q.lte("created_at", f.to);
  if (f.q) {
    const safe = f.q.replace(/[%,()]/g, " ");
    q = q.or(`to_number.ilike.%${safe}%,message.ilike.%${safe}%`);
  }
  return q;
}

export async function GET(request: Request) {
  const session = await getAdminSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!hasAdminAccess(session, "system-agent")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  await reconcileUndeliveredNotifications(60);
  await reconcileOrphanDeliveryEvents();

  const url = new URL(request.url);
  const filters = readFilters(url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 100), 1), 500);
  const offset = Math.max(Number(url.searchParams.get("offset") ?? 0), 0);

  const sb = createSupabaseServiceClient();
  const base = sb.from("system_notifications_log").select(SELECT, { count: "exact" });
  const { data, error, count } = await applyFilters(base, filters)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Tipos distintos para popular o filtro no front.
  const { data: typeRows } = await sb
    .from("system_notifications_log")
    .select("type")
    .order("type", { ascending: true });
  const types = Array.from(new Set((typeRows ?? []).map((r) => r.type).filter(Boolean)));

  return NextResponse.json({ items: data ?? [], total: count ?? 0, types });
}

/**
 * Apaga notificações:
 * - ?id=<uuid>  → uma
 * - ?all=true   → todas
 * - filtros (type/status/q/from/to) → apaga apenas o resultado filtrado
 */
export async function DELETE(request: Request) {
  const session = await getAdminSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!hasAdminAccess(session, "system-agent")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const all = url.searchParams.get("all") === "true";
  const filters = readFilters(url);
  const hasFilter = Boolean(filters.type || filters.status || filters.q || filters.from || filters.to);

  const sb = createSupabaseServiceClient();

  if (id) {
    const { error } = await sb.from("system_notifications_log").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, deleted: "one" });
  }

  if (hasFilter) {
    const { error } = await applyFilters(sb.from("system_notifications_log").delete(), filters);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, deleted: "filtered" });
  }

  if (all) {
    // Guard: neq de um id impossível para evitar delete sem WHERE rejeitado pelo PostgREST.
    const { error } = await sb
      .from("system_notifications_log")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, deleted: "all" });
  }

  return NextResponse.json({ error: "Informe id, all=true ou filtros." }, { status: 400 });
}
