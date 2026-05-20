import { NextRequest, NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const GRAPH = "https://graph.facebook.com/v19.0";

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
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;
  const { session } = guard;

  const pageId = req.nextUrl.searchParams.get("page_id");
  if (!pageId?.trim()) {
    return NextResponse.json({ error: "page_id é obrigatório" }, { status: 400 });
  }

  const sb = createSupabaseServiceClient();

  // Validate that this page belongs to the tenant and retrieve the page access token.
  const { data: connection, error: dbError } = await sb
    .from("meta_connections")
    .select("page_access_token")
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

  const { page_access_token } = connection as { page_access_token: string };

  // Call Meta Graph API — paginate up to 5 pages (500 forms max).
  const forms: MetaFormsForm[] = [];
  let nextUrl: string | null =
    `${GRAPH}/${pageId}/leadgen_forms?fields=id,name,status,created_time&access_token=${encodeURIComponent(page_access_token)}&limit=100`;
  let page = 0;

  while (nextUrl && page < 5) {
    page += 1;
    let res: Response;
    try {
      res = await fetch(nextUrl, { signal: AbortSignal.timeout(10_000) });
    } catch (err) {
      console.error("[meta/forms] network error", err instanceof Error ? err.message : String(err));
      return NextResponse.json(
        { error: `Erro de rede ao contactar a Meta: ${err instanceof Error ? err.message : String(err)}` },
        { status: 502 },
      );
    }

    const raw = (await res.json()) as GraphFormsResponse;

    if (raw.error) {
      console.error("[meta/forms] Meta API error", raw.error.message, raw.error.code);
      return NextResponse.json({ error: `Meta API: ${raw.error.message}` }, { status: 502 });
    }

    for (const f of raw.data ?? []) {
      forms.push({
        form_id: f.id,
        form_name: f.name ?? null,
        status: f.status ?? null,
        created_time: f.created_time ?? null,
      });
    }

    nextUrl = raw.paging?.next ?? null;
  }

  const activeForms = forms.filter((f) => f.status === "ACTIVE");
  return NextResponse.json({ forms: activeForms } satisfies MetaFormsResponse);
}
