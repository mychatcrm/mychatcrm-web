/**
 * POST /api/client/whatsapp-campaigns/import
 *
 * Importa lista de contatos (CSV/colada) para o CRM, pronta para disparo.
 *
 * Duas decisões que valem registro:
 *
 * 1. NÃO reserva cota de leads. A cota é consumida quando o lead é de fato
 *    atendido — e quem faz isso é o envio da campanha, que já reserva por
 *    destinatário. Cobrar na importação faria 5.000 contatos importados
 *    queimarem 5.000 leads do mês mesmo que só 100 recebessem mensagem.
 *
 * 2. O opt-in gravado aqui tem origem própria (`csv_import`), separada do
 *    opt-in em massa da tela. São consentimentos de natureza diferente e
 *    misturar os dois apagaria a trilha de onde cada autorização veio.
 */
import { NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { parseDisparosContactsCsv } from "@/lib/server/disparos-csv-parse";
import { buildWhatsAppLeadInsertPayload } from "@/lib/server/auto-lead-upsert";
import { whatsAppNumberKeyVariants } from "@/lib/server/whatsapp-number-uniqueness";
import { CRM_KANBAN_STATUS_NOVO } from "@/lib/server/crm-lead-lifecycle";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const OPT_IN_SOURCE = "csv_import";

export async function POST(request: Request) {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;

  const body = (await request.json().catch(() => ({}))) as { content?: unknown; optIn?: unknown };
  const content = typeof body.content === "string" ? body.content : "";
  if (!content.trim()) {
    return NextResponse.json({ error: "Envie o conteúdo da lista." }, { status: 400 });
  }

  const parsed = parseDisparosContactsCsv(content);
  if (parsed.contacts.length === 0) {
    return NextResponse.json(
      {
        error: "Nenhum telefone válido encontrado na lista.",
        invalid: parsed.invalid.slice(0, 20),
      },
      { status: 422 },
    );
  }

  const tenantId = guard.session.tenantId;
  const sb = createSupabaseServiceClient();
  const now = new Date().toISOString();

  // A base real tem telefone gravado com e sem o 9º dígito. Comparar só pela
  // forma canônica criaria contato duplicado para quem já existe na grafia
  // antiga — por isso a busca cobre as duas variantes.
  const lookupKeys = new Set<string>();
  for (const contact of parsed.contacts) {
    for (const variant of whatsAppNumberKeyVariants(contact.phone)) lookupKeys.add(variant);
  }

  const { data: existingRows, error: existingError } = await sb
    .from("leads")
    .select("id, phone, whatsapp_opt_in, whatsapp_opt_out_at")
    .eq("tenant_id", tenantId)
    .in("phone", [...lookupKeys]);
  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 503 });
  }

  const existingByPhone = new Map<string, { id: string; optIn: boolean }>();
  for (const row of existingRows ?? []) {
    const phone = String(row.phone ?? "");
    if (!phone) continue;
    existingByPhone.set(phone, {
      id: String(row.id),
      optIn: row.whatsapp_opt_in === true && !row.whatsapp_opt_out_at,
    });
  }

  const matchExisting = (phone: string) => {
    for (const variant of whatsAppNumberKeyVariants(phone)) {
      const found = existingByPhone.get(variant);
      if (found) return found;
    }
    return null;
  };

  const toInsert: ReturnType<typeof buildWhatsAppLeadInsertPayload>[] = [];
  const reusedIds: string[] = [];

  for (const contact of parsed.contacts) {
    const existing = matchExisting(contact.phone);
    if (existing) {
      reusedIds.push(existing.id);
      continue;
    }
    toInsert.push(
      buildWhatsAppLeadInsertPayload({
        tenantId,
        phone: contact.phone,
        contactName: contact.name,
        source: OPT_IN_SOURCE,
        status: CRM_KANBAN_STATUS_NOVO,
        occurredAt: now,
      }),
    );
  }

  let insertedIds: string[] = [];
  if (toInsert.length > 0) {
    const { data: inserted, error: insertError } = await sb
      .from("leads")
      .insert(toInsert)
      .select("id");
    if (insertError) {
      return NextResponse.json(
        { error: `Não foi possível gravar os contatos: ${insertError.message}` },
        { status: 503 },
      );
    }
    insertedIds = (inserted ?? []).map((row) => String(row.id));
  }

  // Opt-in é opcional: quem já tem lista com consentimento registrado fora da
  // plataforma marca aqui; quem não tem importa mesmo assim e decide depois.
  let optedInCount = 0;
  if (body.optIn === true) {
    const needsOptIn = [
      ...insertedIds,
      ...reusedIds.filter((id) => {
        for (const value of existingByPhone.values()) {
          if (value.id === id) return !value.optIn;
        }
        return true;
      }),
    ];
    if (needsOptIn.length > 0) {
      const { error: optInError } = await sb
        .from("leads")
        .update({
          whatsapp_opt_in: true,
          whatsapp_opt_in_at: now,
          whatsapp_opt_in_source: OPT_IN_SOURCE,
          whatsapp_opt_out_at: null,
          updated_at: now,
        })
        .eq("tenant_id", tenantId)
        .in("id", needsOptIn);
      if (optInError) {
        return NextResponse.json({ error: optInError.message }, { status: 503 });
      }
      optedInCount = needsOptIn.length;
    }
  }

  return NextResponse.json({
    ok: true,
    created: insertedIds.length,
    reused: reusedIds.length,
    optedInCount,
    duplicatesInFile: parsed.duplicatesInFile,
    truncated: parsed.truncated,
    invalid: parsed.invalid.slice(0, 20),
    invalidCount: parsed.invalid.length,
  });
}
