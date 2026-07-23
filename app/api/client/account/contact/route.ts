import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { validateCheckoutPhone } from "@/lib/checkout-phone";
import {
  confirmAccountPhoneVerification,
  requestAccountPhoneVerification,
  type AccountPhoneVerificationType,
} from "@/lib/server/account-phone-verification";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { sendSystemNotification } from "@/lib/server/system-agent";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
// O envio da mensagem de verificação (código) ou do aviso de remoção passa
// pela Evolution (presença + delay de digitação + envio real), que pode
// levar bem mais que o timeout padrão da função quando a Evolution está
// lenta. Sem isto, a Vercel matava a função no meio do envio e devolvia 502
// mesmo quando o telefone já tinha sido salvo — o usuário via erro e tinha
// que atualizar a página pra ver o estado real.
export const maxDuration = 60;

type TenantContactRow = {
  system_notification_phone: string | null;
  appointment_notification_phone: string | null;
};

type TenantNotificationPhoneColumn = "system_notification_phone" | "appointment_notification_phone";

type MemberContactRow = {
  id: string;
  phone: string | null;
};

function isMissingTenantNotificationPhoneColumn(error: { message?: string; code?: string } | null | undefined): boolean {
  const message = String(error?.message ?? "").toLowerCase();
  return (
    error?.code === "PGRST204" ||
    message.includes("system_notification_phone") ||
    message.includes("appointment_notification_phone") ||
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

function normalizePhoneType(raw: unknown): AccountPhoneVerificationType | null {
  if (raw === "personal" || raw === "system_notification" || raw === "appointment_notification") return raw;
  return null;
}

function tenantNotificationPhoneColumn(phoneType: AccountPhoneVerificationType): TenantNotificationPhoneColumn {
  return phoneType === "appointment_notification" ? "appointment_notification_phone" : "system_notification_phone";
}

function buildPhoneRemovedMessage(phoneType: AccountPhoneVerificationType): string {
  const label =
    phoneType === "personal"
      ? "telefone da conta"
      : phoneType === "appointment_notification"
        ? "telefone de notificações de agendamentos"
        : "telefone de notificações do sistema";
  return [
    "Aviso MyChatCRM",
    `Este número foi removido como ${label}.`,
    "Se você não reconhece essa alteração, acesse sua conta ou fale com o responsável pela organização.",
  ].join("\n");
}

async function notifyRemovedPhone(params: {
  tenantId: string;
  memberId: string | null;
  phoneType: AccountPhoneVerificationType;
  oldPhone: string | null | undefined;
  newPhone?: string | null;
  changedByEmail: string;
}): Promise<void> {
  const oldDigits = String(params.oldPhone ?? "").replace(/\D/g, "");
  const newDigits = String(params.newPhone ?? "").replace(/\D/g, "");
  if (!oldDigits || oldDigits === newDigits) return;

  const metadata = {
    tenant_id: params.tenantId,
    member_id: params.memberId,
    phone_type: params.phoneType,
    changed_by_email: params.changedByEmail,
    old_phone_last4: oldDigits.slice(-4),
    new_phone_last4: newDigits ? newDigits.slice(-4) : null,
  };

  const sent = await sendSystemNotification(params.oldPhone ?? oldDigits, buildPhoneRemovedMessage(params.phoneType), "", {
    type: "account_phone_removed",
    metadata,
  }).catch((error) => ({
    ok: false,
    error: error instanceof Error ? error.message : "send_failed",
  }));

  if (!sent.ok) {
    console.warn("[client/account/contact] removed_phone_notification_failed", {
      tenantId: params.tenantId,
      phoneType: params.phoneType,
      error: sent.error ?? "send_failed",
    });
  }
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
      .select("system_notification_phone, appointment_notification_phone")
      .eq("id", session.tenantId)
      .maybeSingle(),
    findSessionMember({
      sb,
      tenantId: session.tenantId,
      employeeId: session.employeeId,
      email: session.email,
    }),
  ]);

  if (tenantError && !isMissingTenantNotificationPhoneColumn(tenantError)) {
    return NextResponse.json({ error: tenantError.message }, { status: 500 });
  }

  return NextResponse.json({
    personalPhone: member?.phone ?? null,
    systemNotificationPhone: tenantError ? null : (tenant as TenantContactRow | null)?.system_notification_phone ?? null,
    appointmentNotificationPhone: tenantError
      ? null
      : (tenant as TenantContactRow | null)?.appointment_notification_phone ?? null,
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
  const action = String((body as { action?: unknown }).action ?? "").trim();

  if (action === "request_phone_verification") {
    const phoneType = normalizePhoneType((body as { phoneType?: unknown }).phoneType);
    if (!phoneType) return NextResponse.json({ error: "Tipo de telefone inválido." }, { status: 400 });

    const member = await findSessionMember({
      sb,
      tenantId: session.tenantId,
      employeeId: session.employeeId,
      email: session.email,
    });
    if (!member) {
      return NextResponse.json({ error: "Usuário da conta não encontrado." }, { status: 404 });
    }

    if (phoneType === "personal") {
      const currentPassword = String((body as { currentPassword?: unknown }).currentPassword ?? "").trim();
      if (!currentPassword) {
        return NextResponse.json({ error: "Digite a senha atual para alterar o telefone pessoal." }, { status: 400 });
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
    }

    if (phoneType !== "personal" && !canManageTenantNotifications(session)) {
      return NextResponse.json({ error: "Apenas o dono da conta pode alterar este telefone." }, { status: 403 });
    }

    const requested = await requestAccountPhoneVerification({
      tenantId: session.tenantId,
      memberId: member.id,
      phoneType,
      rawPhone: String((body as { phone?: unknown }).phone ?? ""),
      requestedByEmail: session.email,
      sb,
    });

    if (!requested.ok) {
      return NextResponse.json({ error: requested.error }, { status: requested.status ?? 400 });
    }

    // O código já está salvo — a caixa de "digite o código" pode aparecer
    // agora. O envio de verdade pelo WhatsApp roda em segundo plano.
    waitUntil(requested.dispatchSend());

    return NextResponse.json({
      ok: true,
      phone: requested.phone,
      expiresAt: requested.expiresAt,
      message: "Código enviado pelo agente do sistema para o telefone informado.",
    });
  }

  if (action === "confirm_phone_verification") {
    const phoneType = normalizePhoneType((body as { phoneType?: unknown }).phoneType);
    if (!phoneType) return NextResponse.json({ error: "Tipo de telefone inválido." }, { status: 400 });

    const member = await findSessionMember({
      sb,
      tenantId: session.tenantId,
      employeeId: session.employeeId,
      email: session.email,
    });
    if (!member) {
      return NextResponse.json({ error: "Usuário da conta não encontrado." }, { status: 404 });
    }

    if (phoneType !== "personal" && !canManageTenantNotifications(session)) {
      return NextResponse.json({ error: "Apenas o dono da conta pode alterar este telefone." }, { status: 403 });
    }

    const confirmed = await confirmAccountPhoneVerification({
      tenantId: session.tenantId,
      memberId: member.id,
      phoneType,
      code: String((body as { code?: unknown }).code ?? ""),
      sb,
      applyVerifiedPhone: async (phone) => {
        if (phoneType === "personal") {
          const oldPhone = member.phone;
          const { error } = await sb
            .from("tenant_members")
            .update({ phone })
            .eq("tenant_id", session.tenantId)
            .eq("id", member.id);
          if (error) throw new Error(error.message);
          // Aviso ao número antigo — não faz o usuário esperar o WhatsApp
          // (presença + envio) para saber que o telefone foi salvo.
          waitUntil(
            notifyRemovedPhone({
              tenantId: session.tenantId,
              memberId: member.id,
              phoneType,
              oldPhone,
              newPhone: phone,
              changedByEmail: session.email,
            }),
          );
          return;
        }

        const phoneColumn = tenantNotificationPhoneColumn(phoneType);
        const { data: currentTenant, error: currentTenantError } = await sb
          .from("tenants")
          .select(phoneColumn)
          .eq("id", session.tenantId)
          .maybeSingle();
        if (currentTenantError && !isMissingTenantNotificationPhoneColumn(currentTenantError)) {
          throw new Error(currentTenantError.message);
        }
        const oldPhone = (currentTenant as TenantContactRow | null)?.[phoneColumn] ?? null;
        const { error } = await sb
          .from("tenants")
          .update({ [phoneColumn]: phone })
          .eq("id", session.tenantId);
        if (error) throw new Error(error.message);
        waitUntil(
          notifyRemovedPhone({
            tenantId: session.tenantId,
            memberId: member.id,
            phoneType,
            oldPhone,
            newPhone: phone,
            changedByEmail: session.email,
          }),
        );
      },
    });

    if (!confirmed.ok) {
      return NextResponse.json({ error: confirmed.error }, { status: confirmed.status ?? 400 });
    }

    if (phoneType === "personal") {
      return NextResponse.json({ ok: true, personalPhone: confirmed.phone });
    }
    if (phoneType === "appointment_notification") {
      return NextResponse.json({ ok: true, appointmentNotificationPhone: confirmed.phone });
    }
    return NextResponse.json({ ok: true, systemNotificationPhone: confirmed.phone });
  }

  if (Object.prototype.hasOwnProperty.call(body, "personalPhone")) {
    return NextResponse.json({ error: "Envie e confirme o código antes de salvar o telefone pessoal." }, { status: 400 });
  }

  const clearableTenantPhones: Array<{
    bodyKey: "systemNotificationPhone" | "appointmentNotificationPhone";
    phoneType: AccountPhoneVerificationType;
  }> = [
    { bodyKey: "systemNotificationPhone", phoneType: "system_notification" },
    { bodyKey: "appointmentNotificationPhone", phoneType: "appointment_notification" },
  ];

  for (const { bodyKey, phoneType } of clearableTenantPhones) {
    if (!Object.prototype.hasOwnProperty.call(body, bodyKey)) continue;

    if (!canManageTenantNotifications(session)) {
      return NextResponse.json({ error: "Apenas o dono da conta pode alterar este telefone." }, { status: 403 });
    }

    const normalized = normalizeOptionalPhone((body as Record<string, unknown>)[bodyKey]);
    if (!normalized.ok) return NextResponse.json({ error: normalized.message }, { status: 400 });

    if (normalized.phone) {
      return NextResponse.json({ error: "Envie e confirme o código antes de salvar o telefone de notificações." }, { status: 400 });
    }

    const phoneColumn = tenantNotificationPhoneColumn(phoneType);
    const { data: currentTenant, error: currentTenantError } = await sb
      .from("tenants")
      .select(phoneColumn)
      .eq("id", session.tenantId)
      .maybeSingle();
    if (currentTenantError && !isMissingTenantNotificationPhoneColumn(currentTenantError)) {
      return NextResponse.json({ error: currentTenantError.message }, { status: 500 });
    }
    const oldPhone = (currentTenant as TenantContactRow | null)?.[phoneColumn] ?? null;

    const { error } = await sb
      .from("tenants")
      .update({ [phoneColumn]: normalized.phone })
      .eq("id", session.tenantId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    waitUntil(
      notifyRemovedPhone({
        tenantId: session.tenantId,
        memberId: session.employeeId ?? null,
        phoneType,
        oldPhone,
        newPhone: normalized.phone,
        changedByEmail: session.email,
      }),
    );

    return NextResponse.json({ ok: true, [bodyKey]: normalized.phone });
  }

  return NextResponse.json({ error: "Nenhuma alteração enviada." }, { status: 400 });
}
