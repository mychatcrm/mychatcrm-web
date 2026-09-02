/**
 * POST /api/pre-launch-leads
 * Captura pública (sem sessão) do popup "site em fase final de testes" —
 * visitante clicou em contato/comprar antes do produto estar disponível.
 *
 * Rate limit por IP (mesmo helper das rotas de auth) + campo-armadilha
 * invisível no formulário: se vier preenchido, aceita sem gravar — trava
 * bot simples sem exigir captcha.
 */
import { NextResponse } from "next/server";
import { checkInMemoryRateLimit } from "@/lib/rate-limit-in-memory";
import { getClientIpFromRequest } from "@/lib/get-client-ip";
import { checkWhatsapp } from "@/lib/brazil-whatsapp";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  const ip = getClientIpFromRequest(request) || "unknown";
  const limit = checkInMemoryRateLimit(`pre-launch-lead:${ip}`, 5, 60 * 60_000);
  if (!limit.ok) {
    return NextResponse.json({ error: "Muitos envios. Tente de novo mais tarde." }, { status: 429 });
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });

  // Campo-armadilha: invisível pra gente, bot preenche. Finge sucesso sem gravar.
  if (text(body.website)) return NextResponse.json({ ok: true });

  const fullName = text(body.fullName).slice(0, 200);
  const whatsapp = text(body.whatsapp).slice(0, 20);
  const email = text(body.email).slice(0, 200);
  const businessDescription = text(body.businessDescription).slice(0, 500);
  const source = body.source === "buy" ? "buy" : body.source === "contact" ? "contact" : null;
  const PLANS = ["solo", "equipa", "escala", "enterprise"];
  const planSlug = PLANS.includes(text(body.planSlug)) ? text(body.planSlug) : null;
  const billingCycle =
    body.billingCycle === "annual" ? "annual" : body.billingCycle === "monthly" ? "monthly" : null;

  if (!fullName || fullName.length < 2) return NextResponse.json({ error: "Nome inválido." }, { status: 400 });
  // Mesma validação do formulário, repetida aqui: o cliente pode ser burlado.
  const phone = checkWhatsapp(whatsapp);
  if (!phone.ok) return NextResponse.json({ error: phone.message }, { status: 400 });
  if (!EMAIL_PATTERN.test(email)) return NextResponse.json({ error: "E-mail inválido." }, { status: 400 });
  if (!businessDescription || businessDescription.length < 2) {
    return NextResponse.json({ error: "Conte rapidamente o que você faz." }, { status: 400 });
  }

  const sb = createSupabaseServiceClient();
  const { error } = await sb.from("pre_launch_leads").insert({
    full_name: fullName,
    whatsapp: phone.digits,
    email,
    business_description: businessDescription,
    ddd: phone.ddd,
    source,
    plan_slug: planSlug,
    billing_cycle: billingCycle,
  });
  if (error) {
    console.error("[pre-launch-leads] insert_failed", error.message);
    return NextResponse.json({ error: "Não foi possível salvar agora. Tente de novo." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
