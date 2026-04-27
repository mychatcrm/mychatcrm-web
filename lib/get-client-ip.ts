/** IP do cliente a partir de cabeçalhos de proxy (Vercel, nginx, etc.). */
export function getClientIpFromRequest(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() ?? "";
  }
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();
  return "";
}
