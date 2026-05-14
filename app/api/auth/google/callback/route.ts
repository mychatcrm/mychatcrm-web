import { NextResponse } from "next/server";
import { exchangeGoogleAuthCode } from "@/lib/server/google-calendar";
import { upsertGoogleCalendarToken } from "@/lib/server/google-calendar-db";
import { verifyGoogleOAuthState } from "@/lib/server/google-oauth-state";

export const dynamic = "force-dynamic";

function redirectToAgenda(query: string) {
  const base = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://mychatcrm.vercel.app";
  return NextResponse.redirect(`${base.replace(/\/$/, "")}/dashboard/agenda?${query}`);
}

/** Callback OAuth Google Calendar — persiste tokens e redireciona para Agenda. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) {
    return redirectToAgenda(`google=error&reason=${encodeURIComponent(oauthError)}`);
  }
  if (!code || !state) {
    return redirectToAgenda("google=error&reason=missing_code");
  }

  const tenantId = await verifyGoogleOAuthState(state);
  if (!tenantId) {
    return redirectToAgenda("google=error&reason=invalid_state");
  }

  try {
    const tokens = await exchangeGoogleAuthCode(code);
    await upsertGoogleCalendarToken({
      tenant_id: tenantId,
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expires_at: tokens.expiresAt,
      email: tokens.email,
    });
    return redirectToAgenda("google=connected");
  } catch (err) {
    const message = err instanceof Error ? err.message : "oauth_failed";
    return redirectToAgenda(`google=error&reason=${encodeURIComponent(message.slice(0, 120))}`);
  }
}
