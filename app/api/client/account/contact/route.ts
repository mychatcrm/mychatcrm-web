import { NextRequest, NextResponse } from "next/server";
import { validateCheckoutPhone } from "@/lib/checkout-phone";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type TenantContactRow = {
  system_notification_phone: string | null;
};

type MemberContactRow = {
  id: string;
  phone: string | null;
};

function isMissingSystemNotificationPhoneColumn(error: { message?: string; code?: string } | null | undefined): boolean {
  const message = String(error?.message ?? "").toLowerCase();
  return (
    error?.code === "PGRST204" ||
    message.includes("system_notification_phone") ||
    (message.includes("schema cache") && message.includes("tenants"))
  );
}

function normalizeOptionalPhone(raw: unknown): { ok: true; phone: string | null } | { ok: false; message: string } {
  const value = String(raw ?? "").trim();
  if (!value) return { ok: true, phone: null };
  const validation = validateCheckoutPhone(value);
  if (!validation.ok) return { ok: false, message: validation.message };
  return { ok: true, phone: validation.phone };
}

function canManageTenantNotifications(session: { organizationRole?: string }): boolean {
  return session.organizationRole === "owner";
}

async function findSessionMember(params: {
  sb: ReturnType<typeof createSupabaseServiceClient>;
  tenantId: string;
  employeeId?: string;
  email: string;
}): Promise<MemberContactRow | null> {
  const query = params.sb
    .from("tenant_members")
    .select("id, phone")
    .eq("tenant_id", params.tenantId);

  const { data, error } = params.employeeId
    ? await query.eq("id", params.employeeId).maybeSingle()
    : await query.eq("email", params.email.toLowerCase()).maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as MemberContactRow | null) ?? null;
}

export async function GET(): Promise<NextResponse> {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;
  const { session } = guard;

  const sb = createSupabaseServiceClient();

  const [{ data: tenant, error: tenantError }, member] = await Promise.all([
    sb
      .from("tenants")
      .select("system_notification_phone")
      .eq("id", session.tenantId)
      .maybeSingle(),
    findSessionMember({
      sb,
      tenantId: session.tenantId,
      employeeId: session.employeeId,
      email: session.email,
    }),
  ]);

  if (tenantError && !isMissingSystemNotificationPhoneColumn(tenantError)) {
    return NextResponse.json({ error: tenantError.message }, { status: 500 });
  }

  return NextResponse.json({
    personalPhone: member?.phone ?? null,
    systemNotificationPhone: tenantError ? null : (tenant as TenantContactRow | null)?.system_notification_phone ?? null,
    canManageSystemNotificationPhone: canManageTenantNotifications(session),
  });
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;
  const { session } = guard;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Payload inválido." }, { status: 400 });
  }

  const sb = createSupabaseServiceClient();

  if (Object.prototype.hasOwnProperty.call(body, "personalPhone")) {
    const currentPassword = String((body as { currentPassword?: unknown }).currentPassword ?? "").trim();
    if (!currentPassword) {
      return NextResponse.json({ error: "Digite a senha atual para alterar o telefone pessoal." }, { status: 400 });
    }

    const member = await findSessionMember({
      sb,
      tenantId: session.tenantId,
      employeeId: session.employeeId,
      email: session.email,
    });
    if (!member) {
      return NextResponse.json({ error: "Usuário da conta não encontrado." }, { status: 404 });
    }

    const { data: passwordOk, error: passwordError } = await sb.rpc("verify_member_password", {
      member_id: member.id,
      plain_password: currentPassword,
    });

    if (passwordError) {
      console.error("[client/account/contact] verify_member_password:", passwordError.message);
      return NextResponse.json({ error: "Não foi possível validar a senha atual." }, { status: 500 });
    }
    if (!passwordOk) {
      return NextResponse.json({ error: "Senha atual incorreta." }, { status: 403 });
    }

    const normalized = normalizeOptionalPhone((body as { personalPhone?: unknown }).personalPhone);
    if (!normalized.ok) return NextResponse.json({ error: normalized.message }, { status: 400 });

    const { error } = await sb
      .from("tenant_members")
      .update({ phone: normalized.phone })
      .eq("tenant_id", session.tenantId)
      .eq("id", member.id);

    if (isMissingSystemNotificationPhoneColumn(error)) {
      return NextResponse.json(
        { error: "O banco ainda não reconhece o telefone de notificações. Aplique a migration e tente novamente." },
        { status: 503 },
      );
    }

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, personalPhone: normalized.phone });
  }

  if (Object.prototype.hasOwnProperty.call(body, "systemNotificationPhone")) {
    if (!canManageTenantNotifications(session)) {
      return NextResponse.json({ error: "Apenas o dono da conta pode alterar este telefone." }, { status: 403 });
    }

    const normalized = normalizeOptionalPhone((body as { systemNotificationPhone?: unknown }).systemNotificationPhone);
    if (!normalized.ok) return NextResponse.json({ error: normalized.message }, { status: 400 });

    const { error } = await sb
      .from("tenants")
      .update({ system_notification_phone: normalized.phone })
      .eq("id", session.tenantId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, systemNotificationPhone: normalized.phone });
  }

  return NextResponse.json({ error: "Nenhuma alteração enviada." }, { status: 400 });
}
