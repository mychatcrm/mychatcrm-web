import { cookies } from "next/headers";
import { CLIENT_SESSION_COOKIE, getClientSessionByToken } from "@/lib/client-auth";

/** Apenas Server Components / Route Handlers — usa `next/headers` (não importar a partir de `"use client"`). */
export async function getClientSessionFromCookies() {
  const store = await cookies();
  return await getClientSessionByToken(store.get(CLIENT_SESSION_COOKIE)?.value);
}
