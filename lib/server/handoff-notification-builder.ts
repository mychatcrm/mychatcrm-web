/**
 * handoff-notification-builder.ts
 *
 * Constrói a mensagem de notificação de handoff enviada ao atendente humano.
 *
 * Inclui:
 *  - Nome do lead (tabela leads) ou "Não identificado"
 *  - Número formatado (+55 (62) 99358-0574)
 *  - Link WhatsApp clicável (https://wa.me/...)
 *  - Resumo da conversa gerado por GPT-4o (timeout 10s)
 *  - Dica do que o cliente está precisando
 *  - Fallback para última mensagem se a IA falhar
 */

import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { resolveOpenAiApiKey } from "@/lib/ai/openai-api-key";
import { phoneFromRemoteJid } from "@/lib/server/auto-lead-upsert";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

// ---------------------------------------------------------------------------
// Phone formatting
// ---------------------------------------------------------------------------

/**
 * Formata dígitos de telefone brasileiro para exibição.
 *   556293580574  → +55 (62) 99358-0574   (13 dígitos, com 55)
 *   6293580574    → (62) 99358-0574        (10 dígitos, sem 55)
 *   62993580574   → (62) 99358-0574        (11 dígitos, sem 55)
 */
export function formatBrazilianPhone(digits: string): string {
  if (digits.startsWith("55") && digits.length >= 12) {
    return formatLocalPhone(digits.slice(2), "+55");
  }
  return formatLocalPhone(digits, "");
}

function formatLocalPhone(local: string, prefix: string): string {
  const ddd = local.slice(0, 2);
  const rest = local.slice(2);
  if (rest.length === 9) {
    // 9 dígitos: 99358-0574
    const formatted = `${rest.slice(0, 5)}-${rest.slice(5)}`;
    return [prefix, `(${ddd})`, formatted].filter(Boolean).join(" ");
  }
  if (rest.length === 8) {
    // 8 dígitos: 3358-0574
    const formatted = `${rest.slice(0, 4)}-${rest.slice(4)}`;
    return [prefix, `(${ddd})`, formatted].filter(Boolean).join(" ");
  }
  return [prefix, local].filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// Lead name lookup
// ---------------------------------------------------------------------------

async function fetchLeadName(
  sb: SupabaseServiceClient,
  tenantId: string,
  remoteJid: string,
): Promise<string | null> {
  const phone = phoneFromRemoteJid(remoteJid);
  if (!phone) return null;
  try {
    const { data } = await sb
      .from("leads")
      .select("name")
      .eq("tenant_id", tenantId)
      .eq("phone", phone)
      .not("name", "is", null)
      .maybeSingle();
    const name = typeof (data as { name?: unknown })?.name === "string"
      ? (data as { name: string }).name.trim()
      : null;
    return name || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Recent messages
// ---------------------------------------------------------------------------

type MsgRow = { direction: string; content: string };

async function fetchRecentMessages(
  sb: SupabaseServiceClient,
  tenantId: string,
  remoteJid: string,
): Promise<MsgRow[]> {
  try {
    const { data } = await sb
      .from("whatsapp_messages")
      .select("direction, content")
      .eq("tenant_id", tenantId)
      .eq("remote_jid", remoteJid)
      .not("content", "is", null)
      .order("created_at", { ascending: false })
      .limit(10);
    const rows = Array.isArray(data) ? (data as MsgRow[]) : [];
    return rows.reverse(); // oldest → newest (cronológico)
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// AI summary (GPT-4o, 10s timeout)
// ---------------------------------------------------------------------------

type AiSummaryResult = { summary: string; interest: string };

async function generateConversationSummary(
  messages: MsgRow[],
): Promise<AiSummaryResult | null> {
  if (messages.length === 0) return null;

  const apiKey = await resolveOpenAiApiKey();
  if (!apiKey) return null;

  const transcript = messages
    .map((m) => `${m.direction === "inbound" ? "Cliente" : "Agente"}: ${m.content.trim()}`)
    .join("\n");

  const userPrompt = `Você é um assistente que resume conversas de WhatsApp para atendentes humanos.
Analise a conversa abaixo e responda APENAS com JSON válido (sem markdown, sem blocos de código), no formato:
{"summary":"resumo em 2-3 linhas","interest":"o que o cliente parece precisar ou querer em 1 linha"}

Conversa:
${transcript}`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        max_tokens: 220,
        temperature: 0.3,
        messages: [{ role: "user", content: userPrompt }],
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      console.warn("[handoff-notification-builder] ai_summary_non_ok", { status: res.status });
      return null;
    }

    const json = await res.json() as { choices?: { message?: { content?: string } }[] };
    const raw = json.choices?.[0]?.message?.content?.trim() ?? "";

    // Limpar possível bloco markdown ```json ... ```
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(cleaned) as { summary?: unknown; interest?: unknown };

    const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : null;
    const interest = typeof parsed.interest === "string" ? parsed.interest.trim() : "";

    if (!summary) return null;
    return { summary, interest };
  } catch (err) {
    console.warn(
      "[handoff-notification-builder] ai_summary_error",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

/**
 * Constrói o texto completo da notificação de handoff.
 * Timeout total da IA: 10s. Se falhar, inclui a última mensagem como fallback.
 */
export async function buildHandoffNotificationText(params: {
  sb?: SupabaseServiceClient;
  tenantId: string;
  remoteJid: string;
  reason?: string | null;
}): Promise<string> {
  const sb = params.sb ?? createSupabaseServiceClient();
  const phone = phoneFromRemoteJid(params.remoteJid); // "556293580574"
  const phoneDisplay = formatBrazilianPhone(phone);    // "+55 (62) 99358-0574"
  const waLink = `https://wa.me/${phone}`;

  // Paralelo: nome do lead + mensagens recentes
  const [leadName, recentMessages] = await Promise.all([
    fetchLeadName(sb, params.tenantId, params.remoteJid),
    fetchRecentMessages(sb, params.tenantId, params.remoteJid),
  ]);

  // IA com timeout de 10s (AbortSignal dentro de generateConversationSummary)
  const aiResult = await generateConversationSummary(recentMessages);

  const lines: string[] = [
    "🔔 Novo atendimento aguardando você",
    "",
    `👤 Cliente: ${leadName ?? "Não identificado"}`,
    `📱 ${phoneDisplay}`,
    `🔗 ${waLink}`,
  ];

  if (aiResult) {
    lines.push("");
    lines.push("📋 Resumo da conversa:");
    lines.push(aiResult.summary);
    if (aiResult.interest) {
      lines.push("");
      lines.push(`💡 O cliente parece interessado em: ${aiResult.interest}`);
    }
  } else {
    // Fallback: última mensagem do cliente
    const lastInbound = [...recentMessages].reverse().find((m) => m.direction === "inbound");
    if (lastInbound) {
      lines.push("");
      lines.push(`💬 Última mensagem: ${lastInbound.content.slice(0, 300)}`);
    }
  }

  lines.push("");
  lines.push("⏸ Conversa pausada — o agente não responderá mais até você reativar.");

  return lines.join("\n");
}
