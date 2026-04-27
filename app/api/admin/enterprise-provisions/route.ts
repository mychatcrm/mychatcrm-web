import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, hasAdminAccess } from "@/lib/admin-auth";
import type { EnterpriseProvisionLimits, EnterpriseProvisionRecord } from "@/lib/enterprise-provision-types";
import { appendEnterpriseProvision, readEnterpriseProvisionsFile } from "@/lib/server/enterprise-provisions-fs";
import { teamMemberEmailExistsAcrossTenants, writeTeamEmployeesToDisk } from "@/lib/server/team-employees-fs";
import type { TeamEmployee } from "@/lib/team-employees-types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseLimit(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "boolean") return raw ? null : 0;
  if (typeof raw === "string" && raw.trim().toLowerCase() === "unlimited") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  return Math.floor(n);
}

function parseLimits(body: Record<string, unknown>): EnterpriseProvisionLimits | null {
  const limits = body?.limits;
  if (!limits || typeof limits !== "object") return null;
  const o = limits as Record<string, unknown>;
  return {
    maxDirectors: parseLimit(o.maxDirectors),
    maxManagers: parseLimit(o.maxManagers),
    maxSellers: parseLimit(o.maxSellers),
    includedAgents: parseLimit(o.includedAgents),
    maxSalesFunnels: parseLimit(o.maxSalesFunnels),
    monthlyAttendedLeadsCap: parseLimit(o.monthlyAttendedLeadsCap),
    includedWhatsAppLines: parseLimit(o.includedWhatsAppLines),
  };
}

export async function GET() {
  const session = await getAdminSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!hasAdminAccess(session, "enterprise")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const { provisions } = readEnterpriseProvisionsFile();
  const rows = provisions.map((p) => ({
    id: p.id,
    tenantId: p.tenantId,
    organizationName: p.organizationName,
    ownerEmail: p.ownerEmail,
    ownerName: p.ownerName,
    createdAt: p.createdAt,
    notes: p.notes,
    limits: p.limits,
  }));

  return NextResponse.json({ provisions: rows }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const session = await getAdminSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!hasAdminAccess(session, "enterprise")) {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });

  const organizationName = String(body.organizationName ?? "").trim();
  const ownerName = String(body.ownerName ?? "").trim();
  const ownerEmail = String(body.ownerEmail ?? "").trim().toLowerCase();
  const initialPassword = String(body.initialPassword ?? "").trim();
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";

  if (!organizationName || organizationName.length < 2) {
    return NextResponse.json({ error: "Indique o nome da organização (mín. 2 caracteres)." }, { status: 400 });
  }
  if (!ownerName) return NextResponse.json({ error: "Indique o nome do titular." }, { status: 400 });
  if (!ownerEmail || !EMAIL_RE.test(ownerEmail)) {
    return NextResponse.json({ error: "Indique um e-mail válido para o titular." }, { status: 400 });
  }
  if (initialPassword.length < 8) {
    return NextResponse.json({ error: "A senha inicial deve ter pelo menos 8 caracteres." }, { status: 400 });
  }

  if (teamMemberEmailExistsAcrossTenants(ownerEmail)) {
    return NextResponse.json(
      { error: "Este e-mail já está registado como colaborador noutro tenant." },
      { status: 409 },
    );
  }

  const limits = parseLimits(body);
  if (!limits) {
    return NextResponse.json({ error: "Indique os limites (objeto limits) ou use sem limite (null)." }, { status: 400 });
  }

  const tenantId = `tenant-enterprise-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : Date.now().toString(36)}`;
  const ownerEmployeeId = `emp-ent-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : Date.now().toString(36)}`;
  const provisionId = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `ent-${Date.now()}`;

  const owner: TeamEmployee = {
    id: ownerEmployeeId,
    nome: ownerName,
    email: ownerEmail,
    funcao: "Titular da conta",
    initialPassword,
    ativo: true,
    hierarchyRole: "director",
    accountSuspended: false,
  };

  const record: EnterpriseProvisionRecord = {
    id: provisionId,
    tenantId,
    organizationName,
    ownerEmployeeId,
    ownerEmail,
    ownerName,
    createdAt: new Date().toISOString(),
    notes: notes || undefined,
    limits,
  };

  try {
    writeTeamEmployeesToDisk(tenantId, [owner]);
    appendEnterpriseProvision(record);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "write_error";
    return NextResponse.json({ error: `Falha ao gravar: ${msg}` }, { status: 500 });
  }

  return NextResponse.json(
    {
      ok: true,
      tenantId,
      ownerEmail,
      message:
        "Conta criada. Guarde a senha inicial — não será mostrada de novo. O titular entra em /login com estes dados.",
    },
    { status: 201 },
  );
}
