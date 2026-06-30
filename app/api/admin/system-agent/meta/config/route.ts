import { NextResponse } from "next/server";
import { getAdminSessionFromCookies, hasAdminAccess } from "@/lib/admin-auth";
import {
  clearSystemAgentMetaConfig,
  getSystemAgentMetaConfig,
  saveSystemAgentMetaConfig,
  setSystemActiveProvider,
} from "@/lib/server/system-agent";

export const dynamic = "force-dynamic";

const GRAPH_API = "https://graph.facebook.com/v21.0";

export async function GET() {
  const session = await getAdminSessionFromCookies();
  if (!session || !hasAdminAccess(session, "system-agent")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const config = await getSystemAgentMetaConfig();
  if (!config) {
    return NextResponse.json({ active: false, phone_number_id: null, display_phone: null, verified_name: null });
  }

  return NextResponse.json({
    active: config.active,
    phone_number_id: config.phoneNumberId,
    display_phone: config.displayPhone,
    verified_name: config.verifiedName,
    access_token: "•••••",
  });
}

export async function POST(request: Request) {
  const session = await getAdminSessionFromCookies();
  if (!session || !hasAdminAccess(session, "system-agent")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({})) as { phone_number_id?: string; access_token?: string };
  const phoneNumberId = typeof body.phone_number_id === "string" ? body.phone_number_id.trim() : "";
  const accessToken = typeof body.access_token === "string" ? body.access_token.trim() : "";

  if (!phoneNumberId || !accessToken) {
    return NextResponse.json(
      { error: "phone_number_id e access_token são obrigatórios" },
      { status: 400 },
    );
  }

  const validateUrl =
    `${GRAPH_API}/${encodeURIComponent(phoneNumberId)}` +
    `?fields=display_phone_number,verified_name&access_token=${encodeURIComponent(accessToken)}`;
  const validate = await fetch(validateUrl).catch(() => null);
  if (!validate || !validate.ok) {
    const errorBody = validate ? await validate.text().catch(() => "") : "";
    return NextResponse.json(
      {
        error:
          "Credenciais inválidas — verifique o Phone Number ID e o Access Token na Meta Business Suite",
        detail: errorBody.slice(0, 300),
      },
      { status: 400 },
    );
  }
  const validateData = await validate
    .json()
    .catch(() => ({})) as { display_phone_number?: string; verified_name?: string };

  await saveSystemAgentMetaConfig({
    phoneNumberId,
    accessToken,
    displayPhone: validateData.display_phone_number ?? null,
    verifiedName: validateData.verified_name ?? null,
  });

  return NextResponse.json({
    ok: true,
    active: true,
    phone_number_id: phoneNumberId,
    display_phone: validateData.display_phone_number ?? null,
    verified_name: validateData.verified_name ?? null,
  });
}

/**
 * Alterna qual provedor atende sem apagar credenciais.
 * Body: { active_provider: "evolution" | "meta" }.
 * Trocar para "meta" exige credenciais Meta já salvas.
 */
export async function PATCH(request: Request) {
  const session = await getAdminSessionFromCookies();
  if (!session || !hasAdminAccess(session, "system-agent")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { active_provider?: string };
  const provider = body.active_provider;
  if (provider !== "evolution" && provider !== "meta") {
    return NextResponse.json({ error: "active_provider deve ser 'evolution' ou 'meta'" }, { status: 400 });
  }

  if (provider === "meta") {
    const config = await getSystemAgentMetaConfig();
    if (!config) {
      return NextResponse.json(
        { error: "Conecte as credenciais da API Meta antes de ativá-la." },
        { status: 422 },
      );
    }
  }

  await setSystemActiveProvider(provider);
  return NextResponse.json({ ok: true, active_provider: provider });
}

export async function DELETE() {
  const session = await getAdminSessionFromCookies();
  if (!session || !hasAdminAccess(session, "system-agent")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await clearSystemAgentMetaConfig();
  return NextResponse.json({ ok: true, active: false });
}
