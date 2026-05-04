/**
 * POST /api/checkout/email-availability
 * Verifica em tempo real se um e-mail já tem conta — para UX no CheckoutView.
 *
 * Rate limit simples por IP (em memória, 10 req/min por IP).
 * Nota: em serverless multi-instância o contador não é compartilhado entre instâncias,
 * mas limita abuso na mesma instância — suficiente para UX; a rota Stripe é a garantia final.
 */
import { NextRequest, NextResponse } from "next/server";
import { checkEmailAvailability } from "@/lib/server/email-availability";

// Rate limit em memória: Map<ip, { count, windowStart }>
const RATE_LIMIT_MAP = new Map<string, { count: number; windowStart: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minuto
const RATE_LIMIT_MAX = 15; // até 15 verificações por minuto por IP

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = RATE_LIMIT_MAP.get(ip);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    RATE_LIMIT_MAP.set(ip, { count: 1, windowStart: now });
    return true;
  }

  if (entry.count >= RATE_LIMIT_MAX) return false;

  entry.count += 1;
  return true;
}

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);

  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { available: null, message: "Muitas verificações. Aguarde um momento." },
      { status: 429 },
    );
  }

  let email: string;
  try {
    const body = (await req.json()) as { email?: unknown };
    email = typeof body.email === "string" ? body.email : "";
  } catch {
    return NextResponse.json({ available: null }, { status: 400 });
  }

  if (!email.trim()) {
    return NextResponse.json({ available: null }, { status: 400 });
  }

  const result = await checkEmailAvailability(email);

  if (!result.ok) {
    if (result.reason === "invalid_format") {
      return NextResponse.json({ available: null, code: "INVALID_FORMAT" }, { status: 400 });
    }
    // Supabase falhou — não revelar estado (retornar null para UX mostrar mensagem neutra)
    return NextResponse.json(
      { available: null, code: "CHECK_FAILED" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    { available: result.available, code: result.available ? "FREE" : "TAKEN" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
