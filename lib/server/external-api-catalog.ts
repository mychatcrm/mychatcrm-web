import "server-only";

import type {
  AgentExternalApiLookupRequest,
  ExternalApiNormalizedRecord,
  ExternalApiNormalizedResult,
  ExternalApiParameterDefinition,
} from "@/lib/external-api/types";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

type Row = Record<string, unknown>;
const MAX_RECORDS = 20;

function rowToRecord(row: Row): ExternalApiNormalizedRecord {
  return {
    id: typeof row.external_id === "string" ? row.external_id : null,
    title: typeof row.title === "string" ? row.title : null,
    availability: (row.availability as string | number | boolean | null) ?? null,
    price: (row.price as string | number | null) ?? null,
    currency: typeof row.currency === "string" ? row.currency : null,
    link: typeof row.link === "string" ? row.link : null,
    media: Array.isArray(row.media) ? row.media.filter((item): item is string => typeof item === "string") : [],
    attributes: row.attributes && typeof row.attributes === "object"
      ? row.attributes as Record<string, string | number | boolean | null> : {},
  };
}

/**
 * Lê o catálogo interno sincronizado (`external_api_catalog_items`) em vez de
 * chamar a API do fornecedor ao vivo — usado por `executeAgentExternalApiLookup`
 * quando o conector tem `sync_enabled`. Mesmo contrato de saída
 * (`ExternalApiNormalizedResult`) do caminho ao vivo, pra não mudar nada pro
 * agente que consome isso.
 *
 * `parameters` é a lista DECLARADA da operação (já validada na hora de salvar
 * o conector, nomes restritos a `^[A-Za-z][A-Za-z0-9_]{0,63}$`) — só esses
 * nomes viram filtro de `attributes`. O argumento vem do plano do agente
 * (LLM), então nunca é interpolado direto num caminho de coluna sem passar
 * por essa lista.
 */
export async function queryExternalApiCatalog(params: {
  tenantId: string;
  connectorId: string;
  operationKey: string;
  parameters: ExternalApiParameterDefinition[];
  arguments: AgentExternalApiLookupRequest["arguments"];
}): Promise<ExternalApiNormalizedResult> {
  const sb = createSupabaseServiceClient();
  const args = new Map(params.arguments.map((item) => [item.name, item.value]));

  if (params.operationKey === "detalhar") {
    const id = args.get("id");
    if (id == null) return { records: [], truncated: false };
    const { data, error } = await sb.from("external_api_catalog_items").select("*")
      .eq("tenant_id", params.tenantId).eq("connector_id", params.connectorId)
      .eq("is_active", true).eq("external_id", String(id)).limit(1);
    if (error) throw new Error(`external_api_catalog_query:${error.message}`);
    return { records: ((data ?? []) as Row[]).map(rowToRecord), truncated: false };
  }

  let query = sb.from("external_api_catalog_items").select("*")
    .eq("tenant_id", params.tenantId).eq("connector_id", params.connectorId).eq("is_active", true);

  if (params.operationKey === "buscar") {
    const textParam = params.parameters.find((definition) => definition.name === "query" && definition.type === "string");
    const textValue = textParam ? args.get(textParam.name) : undefined;
    if (typeof textValue === "string" && textValue.trim()) {
      // Escapa curinga do ilike e o que quebraria a sintaxe do .or() do PostgREST.
      const safe = textValue.trim().slice(0, 200).replace(/[%_,()]/g, "");
      if (safe) query = query.or(`title.ilike.%${safe}%,description.ilike.%${safe}%`);
    }
    for (const definition of params.parameters) {
      if (definition.name === "query") continue;
      const value = args.get(definition.name);
      if (value == null) continue;
      query = query.eq(`attributes->>${definition.name}`, String(value).slice(0, 500));
    }
  }

  const { data, error } = await query.order("updated_at", { ascending: false }).limit(MAX_RECORDS + 1);
  if (error) throw new Error(`external_api_catalog_query:${error.message}`);
  const rows = (data ?? []) as Row[];
  return { records: rows.slice(0, MAX_RECORDS).map(rowToRecord), truncated: rows.length > MAX_RECORDS };
}
