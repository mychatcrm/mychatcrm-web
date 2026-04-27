import { NextResponse } from "next/server";
import { adminSessionCookieOptions } from "@/lib/admin-auth";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    ...adminSessionCookieOptions(),
    value: "",
    maxAge: 0,
  });
  return response;
}
