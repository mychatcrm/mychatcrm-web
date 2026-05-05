import { SITE_URL } from "@/lib/constants";

/**
 * Base URL for links no e-mail de recuperação.
 * Usa o `request.url` do handler (origem real do POST), para que deploys em
 * *.vercel.app gerem links para o mesmo host (Preview) em vez de só NEXT_PUBLIC_SITE_URL.
 */
export function passwordResetPublicOrigin(request: Request): string {
  try {
    const u = new URL(request.url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return SITE_URL;
    if (!u.host) return SITE_URL;
    return u.origin;
  } catch {
    return SITE_URL;
  }
}
