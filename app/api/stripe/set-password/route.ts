/**
 * POST /api/stripe/set-password
 * Usa o token de ativação para definir a senha do novo cliente.
 */
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { token?: string; password?: string };
    const { token, password } = body;

    if (!token || !password) {
      return NextResponse.json({ message: "Token e senha são obrigatórios." }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json(
        { message: "A senha deve ter pelo menos 8 caracteres." },
        { status: 400 },
      );
    }

    const sb = createSupabaseServiceClient();

    // Busca e valida o token
    const { data: tokenRow, error: tokenErr } = await sb
      .from("activation_tokens")
      .select("*")
      .eq("token", token)
      .eq("used", false)
      .gt("expires_at", new Date().toISOString())
      .single();

    if (tokenErr || !tokenRow) {
      return NextResponse.json(
        { message: "Link de ativação inválido ou expirado. Entre em contacto com o suporte." },
        { status: 400 },
      );
    }

    // Atualiza a senha via RPC (hash feito no banco)
    const { error: pwErr } = await sb.rpc("update_member_password", {
      p_id: tokenRow.member_id,
      p_new_password: password,
    });

    if (pwErr) {
      console.error("[set-password] update_member_password:", pwErr.message);
      return NextResponse.json({ message: "Não foi possível definir a senha." }, { status: 500 });
    }

    // Marca token como usado
    await sb
      .from("activation_tokens")
      .update({ used: true })
      .eq("id", tokenRow.id);

    return NextResponse.json({ ok: true, email: tokenRow.email });
  } catch (err) {
    console.error("[set-password]", err);
    return NextResponse.json({ message: "Erro inesperado. Tente novamente." }, { status: 500 });
  }
}
