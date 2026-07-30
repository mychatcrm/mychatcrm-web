import { NextRequest, NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { metaGraphErrorCode, metaGraphRequest } from "@/lib/server/meta-graph-api";

export const dynamic = "force-dynamic";

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
    .select("page_access_token, health_status, health_message")
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

  console.info("[meta/form-fields] fetching", { formId, pageId, tenantId: session.tenantId });

  let raw: GraphFormResponse;
  try {
    raw = await metaGraphRequest<GraphFormResponse>(
      `/${encodeURIComponent(formId)}`,
      {
        accessToken: page_access_token,
        searchParams: { fields: "questions" },
      },
    );
  } catch (err) {
    const code = metaGraphErrorCode(err);
    console.error("[meta/form-fields] Graph error", { formId, pageId, code });
    return NextResponse.json(
      { error: `A Meta não permitiu consultar os campos deste formulário (${code}).` },
      { status: 502 },
    );
  }

  const fields: MetaFormField[] = (raw.questions ?? [])
    .filter((q): q is Required<Pick<GraphFormQuestion, "key">> & GraphFormQuestion => Boolean(q.key))
    .map((q) => ({
      key: q.key!,
      label: q.label ?? q.key!,
      type: q.type ?? "CUSTOM",
    }));

  console.info("[meta/form-fields] ok", { formId, fieldCount: fields.length });

  return NextResponse.json({ fields } satisfies MetaFormFieldsResponse);
}
