import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/**
 * Redireciona pedidos HTTP → HTTPS quando o proxy envia `x-forwarded-proto: http`.
 * Activa só em `NODE_ENV=production` (desligar com `DISABLE_HTTPS_REDIRECT=1` ou em localhost).
 */
export function redirectHttpToHttpsInProduction(request: NextRequest): NextResponse | null {
  if (process.env.NODE_ENV !== "production") return null;
  if (process.env.DISABLE_HTTPS_REDIRECT === "1") return null;

  const host = request.headers.get("host") ?? "";
  if (/^(localhost|127\.0\.0\.1)(\:|$)/i.test(host)) return null;

  const proto = request.headers.get("x-forwarded-proto");
  if (proto !== "http") return null;

  const url = request.nextUrl.clone();
  url.protocol = "https:";
  return NextResponse.redirect(url, 308);
}
