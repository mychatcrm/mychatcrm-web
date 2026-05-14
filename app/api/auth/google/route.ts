import { NextResponse } from "next/server";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { buildGoogleOAuthUrl, isGoogleCalendarConfigured } from "@/lib/server/google-calendar";
import { signGoogleOAuthState } from "@/lib/server/google-oauth-state";

export const dynamic = "force-dynamic";

/** Inicia OAuth Google Calendar — redireciona para consentimento Google. */
export async function GET() {
  const session = await getClientSessionFromCookies();
  if (!session) {
    return NextResponse.redirect(new URL("/login?next=/dashboard/agenda", process.env.NEXT_PUBLIC_SITE_URL || "https://mychatcrm.vercel.app"));
  }
  if (!isGoogleCalendarConfigured()) {
    return NextResponse.json({ error: "Google Calendar não configurado no servidor." }, { status: 503 });
  }
  const state = await signGoogleOAuthState(session.tenantId);
  if (!state) {
    return NextResponse.json({ error: "Não foi possível iniciar OAuth (segredo de sessão ausente)." }, { status: 503 });
  }
  const url = buildGoogleOAuthUrl(state);
  if (!url) {
    return NextResponse.json({ error: "Google Calendar não configurado." }, { status: 503 });
  }
  return NextResponse.redirect(url);
}
