import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { CLIENT_SESSION_COOKIE, clientSessionCookieOptions, deleteLiveClientSession } from "@/lib/client-auth";

export async function POST() {
  const store = await cookies();
  const token = store.get(CLIENT_SESSION_COOKIE)?.value;
  if (token && !token.startsWith("mc1.")) deleteLiveClientSession(token);

  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    ...clientSessionCookieOptions(),
    value: "",
    maxAge: 0,
  });
  return response;
}
