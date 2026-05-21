import { NextRequest, NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const GRAPH = "https://graph.facebook.com/v19.0";

export type MetaFormField = {
  key: string;
  label: string;
  type: string;
};

export type MetaFormFieldsResponse = {
  fields: MetaFormField[];
};

type GraphFormQuestion = {
  id?: string;
  key?: string;
  label?: string;
  type?: string;
};

type GraphFormResponse = {
  id?: string;
  questions?: GraphFormQuestion[];
  error?: { message: string; type?: string; code?: number };
};

/** Returns the real field list for a single Meta Lead Ads form. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;
  const { session } = guard;

  const formId = req.nextUrl.searchParams.get("form_id");
  const pageId = req.nextUrl.searchParams.get("page_id");

  if (!formId?.trim()) {
    return NextResponse.json({ error: "form_id é obrigatório" }, { status: 400 });
  }
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
    console.error("[meta/form-fields] db error", dbError.message);
    return NextResponse.json({ error: dbError.message }, { status: 500 });
  }

  if (!connection) {
    return NextResponse.json({ error: "Página não conectada" }, { status: 404 });
  }

  const { page_access_token } = connection as { page_access_token: string };

  // Fetch the form questions from the Meta Graph API.
  const url = `${GRAPH}/${encodeURIComponent(formId)}?fields=questions&access_token=${encodeURIComponent(page_access_token)}`;

  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[meta/form-fields] network error", msg);
    return NextResponse.json({ error: `Erro de rede ao contactar a Meta: ${msg}` }, { status: 502 });
  }

  const raw = (await res.json()) as GraphFormResponse;

  if (raw.error) {
    console.error("[meta/form-fields] Meta API error", raw.error.message, raw.error.code);
    return NextResponse.json({ error: `Meta API: ${raw.error.message}` }, { status: 502 });
  }

  const fields: MetaFormField[] = (raw.questions ?? [])
    .filter((q): q is Required<Pick<GraphFormQuestion, "key">> & GraphFormQuestion => Boolean(q.key))
    .map((q) => ({
      key: q.key!,
      label: q.label ?? q.key!,
      type: q.type ?? "CUSTOM",
    }));

  return NextResponse.json({ fields } satisfies MetaFormFieldsResponse);
}
