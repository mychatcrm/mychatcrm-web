import { NextRequest, NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { metaGraphErrorCode, metaGraphRequest } from "@/lib/server/meta-graph-api";

export const dynamic = "force-dynamic";
export const preferredRegion = "gru1";

const META_FORMS_CACHE_MS = 5 * 60_000;
const formsCache = new Map<string, { expiresAt: number; forms: MetaFormsForm[] }>();

export type MetaFormsForm = {
  form_id: string;
  form_name: string | null;
  status: string | null;
  created_time: string | null;
};

export type MetaFormsResponse = {
  forms: MetaFormsForm[];
};

type GraphFormsResponse = {
  data?: { id: string; name?: string; status?: string; created_time?: string }[];
  paging?: { next?: string };
  error?: { message: string; type?: string; code?: number };
};

/** Returns all leadgen forms for a connected Facebook page. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const startedAt = performance.now();
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;
  const { session } = guard;

  const pageId = req.nextUrl.searchParams.get("page_id");
  if (!pageId?.trim()) {
    return NextResponse.json({ error: "page_id é obrigatório" }, { status: 400 });
  }

  const cacheKey = `${session.tenantId}:${pageId.trim()}`;
  const cached = formsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(
      { forms: cached.forms } satisfies MetaFormsResponse,
      {
        headers: {
          "Cache-Control": "private, no-store",
          "Server-Timing": `meta-forms-cache;dur=${Math.round(performance.now() - startedAt)}`,
        },
      },
    );
  }

  const sb = createSupabaseServiceClient();

  // Validate that this page belongs to the tenant and retrieve the page access token.
  const { data: connection, error: dbError } = await sb
    .from("meta_connections")
    .select("page_access_token, health_status, health_message")
    .eq("tenant_id", session.tenantId)
    .eq("page_id", pageId)
    .maybeSingle();

  if (dbError) {
    console.error("[meta/forms] db error", dbError.message);
    return NextResponse.json({ error: dbError.message }, { status: 500 });
  }

  if (!connection) {
    return NextResponse.json({ error: "Página não conectada" }, { status: 404 });
  }

  const { page_access_token, health_status, health_message } = connection as {
    page_access_token: string;
    health_status: string;
    health_message: string | null;
  };
  if (
    health_status !== "ready" &&
    health_status !== "degraded" &&
    health_status !== "legacy_grace"
  ) {
    return NextResponse.json(
      {
        error:
          health_message ??
          "A conexão Meta ainda não foi validada. Verifique-a em Integrações.",
      },
      { status: 409 },
    );
  }

  // Call Meta Graph API — paginate up to 5 pages (500 forms max).
  const forms: MetaFormsForm[] = [];
  let nextUrl: string | null = `/${encodeURIComponent(pageId)}/leadgen_forms`;
  let page = 0;
  let firstPage = true;

  while (nextUrl && page < 5) {
    page += 1;
    try {
      const raw: GraphFormsResponse = await metaGraphRequest<GraphFormsResponse>(nextUrl, {
        accessToken: page_access_token,
        searchParams: firstPage
          ? { fields: "id,name,status,created_time", limit: 100 }
          : undefined,
      });
      firstPage = false;

      for (const f of raw.data ?? []) {
        forms.push({
          form_id: f.id,
          form_name: f.name ?? null,
          status: f.status ?? null,
          created_time: f.created_time ?? null,
        });
      }
      nextUrl = raw.paging?.next ?? null;
    } catch (err) {
      const code = metaGraphErrorCode(err);
      console.error("[meta/forms] Graph error", { pageId, code });
      return NextResponse.json(
        { error: `A Meta não permitiu consultar os formulários (${code}).` },
        { status: 502 },
      );
    }
  }

  const activeForms = forms.filter((f) => f.status === "ACTIVE");
  formsCache.set(cacheKey, { expiresAt: Date.now() + META_FORMS_CACHE_MS, forms: activeForms });
  return NextResponse.json(
    { forms: activeForms } satisfies MetaFormsResponse,
    {
      headers: {
        "Cache-Control": "private, no-store",
        "Server-Timing": `meta-forms;dur=${Math.round(performance.now() - startedAt)}`,
      },
    },
  );
}
