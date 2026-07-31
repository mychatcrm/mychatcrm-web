import { NextResponse } from "next/server";
import { requireActiveClientSession } from "@/lib/server/client-session-guard";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  MetaGraphRequestError,
  metaGraphErrorCode,
  metaGraphRequest,
} from "@/lib/server/meta-graph-api";

export const dynamic = "force-dynamic";

export type MetaStatusForm = {
  form_id: string;
  form_name: string | null;
  agent_id: string | null;
  has_active_rule: boolean;
};

export type MetaStatusPage = {
  page_id: string;
  page_name: string | null;
  connected_at: string;
  health_status:
    | "provisioning"
    | "ready"
    | "retrying"
    | "action_required"
    | "revoked"
    | "unverified"
    | "legacy_grace"
    | "degraded";
  health_code: string | null;
  health_message: string | null;
  lead_access_status:
    | "unverified"
    | "pending_first_lead"
    | "verified_by_retrieval"
    | "verified_by_delivery"
    | "action_required";
  last_lead_access_verified_at: string | null;
  last_verified_at: string | null;
  last_webhook_at: string | null;
  subscribed_fields: string[];
  forms_error: string | null;
  forms: MetaStatusForm[];
};

export type MetaStatusResponse = {
  connected: boolean;
  action_required: boolean;
  verification_pending: boolean;
  grant_discovery_status:
    | "pending"
    | "discovering"
    | "ready"
    | "retrying"
    | "action_required"
    | null;
  grant_error_code: string | null;
  pages: MetaStatusPage[];
};

type MetaConnectionRow = {
  page_id: string;
  page_name: string | null;
  connected_at: string;
  page_access_token: string;
  health_status: MetaStatusPage["health_status"];
  health_code: string | null;
  health_message: string | null;
  lead_access_status: MetaStatusPage["lead_access_status"];
  last_lead_access_verified_at: string | null;
  last_verified_at: string | null;
  last_webhook_at: string | null;
  subscribed_fields: string[] | null;
};

type MetaRuleRow = {
  page_id: string | null;
  use_all_forms: boolean | null;
  included_form_ids: unknown;
  excluded_form_ids: unknown;
  agent_ids: unknown;
  order_index: number | null;
};

type MetaLeadgenFormsResponse = {
  data?: Array<{ id?: string; name?: string }>;
  paging?: { next?: string };
};

type MetaLeadGrantRow = {
  discovery_status: MetaStatusResponse["grant_discovery_status"];
  last_error_code: string | null;
};

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

async function fetchPageLeadgenForms(
  pageId: string,
  pageAccessToken: string,
): Promise<{ forms: MetaStatusForm[]; error: string | null }> {
  const forms: MetaStatusForm[] = [];
  let nextUrl: string | undefined = `/${encodeURIComponent(pageId)}/leadgen_forms`;
  let firstPage = true;

  try {
    while (nextUrl && forms.length < 500) {
      const data: MetaLeadgenFormsResponse =
        await metaGraphRequest<MetaLeadgenFormsResponse>(nextUrl, {
          accessToken: pageAccessToken,
          searchParams: firstPage ? { fields: "id,name", limit: 100 } : undefined,
        });
      firstPage = false;
      for (const form of data.data ?? []) {
        if (form.id) {
          forms.push({
            form_id: form.id,
            form_name: form.name ?? null,
            agent_id: null,
            has_active_rule: false,
          });
        }
      }
      nextUrl = data.paging?.next;
    }
    return { forms, error: null };
  } catch (error) {
    const code = metaGraphErrorCode(error);
    console.warn("[meta/status] forms probe failed", {
      pageId,
      code,
      retryable: error instanceof MetaGraphRequestError ? error.retryable : false,
    });
    return { forms, error: code };
  }
}

/** Canonical Meta connection health. Existence of a DB row is not connectivity. */
export async function GET(): Promise<NextResponse> {
  const guard = await requireActiveClientSession();
  if (!guard.ok) return guard.response;
  const { session } = guard;

  const sb = createSupabaseServiceClient();
  const [connectionsResult, grantResult] = await Promise.all([
    sb
      .from("meta_connections")
      .select(
        "page_id, page_name, connected_at, page_access_token, health_status, health_code, health_message, lead_access_status, last_lead_access_verified_at, last_verified_at, last_webhook_at, subscribed_fields",
      )
      .eq("tenant_id", session.tenantId)
      .order("connected_at", { ascending: true })
      .returns<MetaConnectionRow[]>(),
    sb
      .from("meta_lead_grants")
      .select("discovery_status, last_error_code")
      .eq("tenant_id", session.tenantId)
      .maybeSingle<MetaLeadGrantRow>(),
  ]);
  const { data: connections, error: connectionsError } = connectionsResult;
  const { data: grant, error: grantError } = grantResult;

  if (connectionsError) {
    return NextResponse.json({ error: connectionsError.message }, { status: 500 });
  }
  if (grantError) {
    return NextResponse.json({ error: grantError.message }, { status: 500 });
  }
  if (!connections?.length) {
    const grantPending =
      grant?.discovery_status === "pending" ||
      grant?.discovery_status === "discovering" ||
      grant?.discovery_status === "retrying";
    return NextResponse.json(
      {
        connected: false,
        action_required: grant?.discovery_status === "action_required",
        verification_pending: grantPending,
        grant_discovery_status: grant?.discovery_status ?? null,
        grant_error_code: grant?.last_error_code ?? null,
        pages: [],
      } satisfies MetaStatusResponse,
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const { data: rules, error: rulesError } = await sb
    .from("lead_distribution_rules")
    .select(
      "page_id, use_all_forms, included_form_ids, excluded_form_ids, agent_ids, order_index",
    )
    .eq("tenant_id", session.tenantId)
    .eq("source", "meta_form")
    .eq("active", true)
    .returns<MetaRuleRow[]>();
  if (rulesError) {
    return NextResponse.json({ error: rulesError.message }, { status: 500 });
  }

  const activeRules = [...(rules ?? [])].sort(
    (a, b) => (a.order_index ?? 999) - (b.order_index ?? 999),
  );

  const pages: MetaStatusPage[] = await Promise.all(
    connections.map(async (connection) => {
      const graph =
        connection.health_status === "ready" ||
        connection.health_status === "degraded" ||
        connection.health_status === "legacy_grace"
          ? await fetchPageLeadgenForms(connection.page_id, connection.page_access_token)
          : { forms: [] as MetaStatusForm[], error: null };
      const forms = graph.forms.map((form) => ({
        ...form,
        ...(() => {
          for (const rule of activeRules) {
            if (rule.page_id?.trim() !== connection.page_id) continue;
            if (stringArray(rule.excluded_form_ids).includes(form.form_id)) continue;
            const matches =
              rule.use_all_forms === true ||
              stringArray(rule.included_form_ids).includes(form.form_id);
            if (!matches) continue;
            return {
              agent_id: stringArray(rule.agent_ids)[0] ?? null,
              has_active_rule: true,
            };
          }
          return { agent_id: null, has_active_rule: false };
        })(),
      }));
      return {
        page_id: connection.page_id,
        page_name: connection.page_name,
        connected_at: connection.connected_at,
        health_status: connection.health_status ?? "unverified",
        health_code: connection.health_code,
        health_message: connection.health_message,
        lead_access_status: connection.lead_access_status ?? "unverified",
        last_lead_access_verified_at: connection.last_lead_access_verified_at,
        last_verified_at: connection.last_verified_at,
        last_webhook_at: connection.last_webhook_at,
        subscribed_fields: connection.subscribed_fields ?? [],
        forms_error: graph.error,
        forms,
      };
    }),
  );

  const grantBlocksConnected =
    grant?.discovery_status === "pending" ||
    grant?.discovery_status === "discovering" ||
    grant?.discovery_status === "retrying" ||
    grant?.discovery_status === "action_required";
  const connected =
    !grantBlocksConnected &&
    pages.some(
      (page) =>
        page.health_status === "ready" ||
        page.health_status === "degraded" ||
        page.health_status === "legacy_grace",
    );
  const actionRequired = pages.some(
    (page) =>
      page.health_status === "action_required" ||
      page.health_status === "revoked" ||
      page.lead_access_status === "action_required" ||
      Boolean(page.forms_error),
  ) || grant?.discovery_status === "action_required";
  const verificationPending = pages.some(
    (page) =>
      page.health_status === "provisioning" ||
      page.health_status === "retrying" ||
      page.health_status === "unverified" ||
      page.health_status === "degraded" ||
      page.health_status === "legacy_grace" ||
      page.lead_access_status === "unverified" ||
      page.lead_access_status === "pending_first_lead",
  ) ||
    grant?.discovery_status === "pending" ||
    grant?.discovery_status === "discovering" ||
    grant?.discovery_status === "retrying";
  return NextResponse.json(
    {
      connected,
      action_required: actionRequired,
      verification_pending: verificationPending,
      grant_discovery_status: grant?.discovery_status ?? null,
      grant_error_code: grant?.last_error_code ?? null,
      pages,
    } satisfies MetaStatusResponse,
    { headers: { "Cache-Control": "no-store" } },
  );
}
