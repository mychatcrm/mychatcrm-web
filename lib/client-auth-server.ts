import { cookies } from "next/headers";
import { CLIENT_SESSION_COOKIE, getClientSessionByToken } from "@/lib/client-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

/** Apenas Server Components / Route Handlers — usa `next/headers` (não importar a partir de `"use client"`). */
export async function getClientSessionFromCookies() {
  const store = await cookies();
  const session = await getClientSessionByToken(store.get(CLIENT_SESSION_COOKIE)?.value);
  if (!session) return null;

  // Post-reset invalidation: if the session was issued before the user's last password change,
  // reject it so they must re-login. Only applies to employee (member) sessions with issuedAt.
  const employeeId = session.employeeId;
  const issuedAt = session.issuedAt;
  if (employeeId && issuedAt) {
    try {
      const sb = createSupabaseServiceClient();
      const { data } = await sb
        .from("tenant_members")
        .select("password_changed_at")
        .eq("id", employeeId)
        .maybeSingle();
      if (data?.password_changed_at) {
        const changedAt = new Date(data.password_changed_at as string).getTime();
        if (issuedAt < changedAt) return null;
      }
    } catch {
      // If the check fails, allow the session to continue — fail open for availability.
    }
  }

  return session;
}
