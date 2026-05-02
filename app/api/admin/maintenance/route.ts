import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, hasAdminAccess } from "@/lib/admin-auth";
import { readMaintenanceState, writeMaintenanceState } from "@/lib/server/maintenance-store-db";

function forbidden() {
  return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
}

function unauthorized() {
  return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
}

export async function GET() {
  const session = await getAdminSessionFromCookies();
  if (!session) return unauthorized();
  if (!hasAdminAccess(session, "seguranca")) return forbidden();

  const s = await readMaintenanceState();
  return NextResponse.json({
    enabled: s.enabled,
    message: s.message,
    estimatedReturnAt: s.estimatedReturnAt ?? "",
    updatedAt: s.updatedAt,
    updatedByAdminEmail: s.updatedByAdminId ?? "",
  });
}

export async function PATCH(request: Request) {
  const session = await getAdminSessionFromCookies();
  if (!session) return unauthorized();
  if (!hasAdminAccess(session, "seguranca")) return forbidden();

  const body = (await request.json().catch(() => null)) as {
    enabled?: unknown;
    message?: unknown;
    estimatedReturnAt?: unknown;
  } | null;

  if (!body || typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "Campo «enabled» (boolean) obrigatório." }, { status: 400 });
  }

  const prev = await readMaintenanceState();
  const message =
    typeof body.message === "string" ? body.message.trim().slice(0, 2000) : prev.message;
  const estimatedReturnAt =
    typeof body.estimatedReturnAt === "string"
      ? body.estimatedReturnAt.trim().slice(0, 80)
      : (prev.estimatedReturnAt ?? "");

  await writeMaintenanceState({
    enabled: body.enabled,
    message,
    estimatedReturnAt: estimatedReturnAt || undefined,
    updatedByAdminId: session.email,
  });

  return NextResponse.json({
    ok: true,
    enabled: body.enabled,
    message,
    estimatedReturnAt,
    updatedAt: new Date().toISOString(),
    updatedByAdminEmail: session.email,
  });
}
