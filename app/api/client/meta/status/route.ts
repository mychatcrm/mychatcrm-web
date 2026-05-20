import { NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export type MetaStatusPage = {
  page_id: string;
  page_name: string | null;
  connected_at: string;
  forms: MetaStatusForm[];
};

export type MetaStatusForm = {
  form_id: string;
  form_name: string | null;
  agent_id: string | null;
};

export type MetaStatusResponse = {
  connected: boolean;
  pages: MetaStatusPage[];
};

type MetaConnectionRow = {
  page_id: string;
  page_name: string | null;
  connected_at: string;
  page_access_token: string;
};

type MetaLeadgenFormsResponse = {
  data?: Array<{ id?: string; name?: string }>;
  paging?: { next?: string };
};

const GRAPH = "https://graph.facebook.com/v19.0";

async function fetchPageLeadgenForms(pageId: string, pageAccessToken: string): Promise<MetaStatusForm[]> {
  const forms: MetaStatusForm[] = [];
  let nextUrl: string | undefined = `${GRAPH}/${encodeURIComponent(pageId)}/leadgen_forms?fields=id,name&access_token=${encodeURIComponent(pageAccessToken)}`;

  try {
    while (nextUrl && forms.length < 500) {
      const res = await fetch(nextUrl, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return forms;
      const data = (await res.json()) as MetaLeadgenFormsResponse;
      for (const form of data.data ?? []) {
        if (form.id) {
          forms.push({
            form_id: form.id,
            form_name: form.name ?? null,
            agent_id: null,
          });
        }
      }
      nextUrl = data.paging?.next;
    }
  } catch {
    return forms;
  }

  return forms;
}

/** Returns Meta connection status and all connected pages with their form-agent mappings. */
export async function GET(): Promise<NextResponse> {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;
  const { session } = guard;

  const sb = createSupabaseServiceClient();

  const { data: connections, error: connectionsError } = await sb
    .from("meta_connections")
    .select("page_id, page_name, connected_at, page_access_token")
    .eq("tenant_id", session.tenantId)
    .order("connected_at", { ascending: true })
    .returns<MetaConnectionRow[]>();

  if (connectionsError) {
    return NextResponse.json({ error: connectionsError.message }, { status: 500 });
  }

  if (!connections?.length) {
    return NextResponse.json({ connected: false, pages: [] } satisfies MetaStatusResponse);
  }

  const pageIds = connections.map((c) => c.page_id);
  const { data: mappings, error: mappingsError } = await sb
    .from("meta_form_agent_mapping")
    .select("form_id, form_name, agent_id, page_id")
    .eq("tenant_id", session.tenantId)
    .in("page_id", pageIds);

  if (mappingsError) {
    return NextResponse.json({ error: mappingsError.message }, { status: 500 });
  }

  const pages: MetaStatusPage[] = await Promise.all(
    connections.map(async (conn) => {
      const graphForms = await fetchPageLeadgenForms(conn.page_id, conn.page_access_token);
      const mappingForms = (mappings ?? [])
        .filter((m) => m.page_id === conn.page_id)
        .map((m) => ({
          form_id: m.form_id,
          form_name: m.form_name,
          agent_id: m.agent_id,
        }));
      const formsById = new Map<string, MetaStatusForm>();
      for (const form of graphForms) formsById.set(form.form_id, form);
      for (const mapping of mappingForms) {
        formsById.set(mapping.form_id, {
          ...formsById.get(mapping.form_id),
          form_id: mapping.form_id,
          form_name: formsById.get(mapping.form_id)?.form_name ?? mapping.form_name,
          agent_id: mapping.agent_id,
        });
      }
      return {
        page_id: conn.page_id,
        page_name: conn.page_name,
        connected_at: conn.connected_at,
        forms: Array.from(formsById.values()),
      };
    }),
  );

  return NextResponse.json({ connected: pages.length > 0, pages } satisfies MetaStatusResponse);
}
