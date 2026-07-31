import "server-only";
import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SITE_URL } from "@/lib/constants";
import {
  META_GRAPH_API_VERSION,
  MetaGraphRequestError,
  metaGraphErrorCode,
  metaGraphRequest,
} from "@/lib/server/meta-graph-api";
import {
  META_PAGE_LEADGEN_WEBHOOK_FIELDS,
  subscribePageToLeadgenWebhooks,
} from "@/lib/server/meta-page-webhook-subscribe";

export const REQUIRED_META_LEAD_SCOPES = [
  "leads_retrieval",
  "pages_manage_metadata",
  "pages_read_engagement",
  "pages_show_list",
] as const;

export type MetaConnectionHealthStatus =
  | "provisioning"
  | "ready"
  | "retrying"
  | "degraded"
  | "action_required"
  | "revoked"
  | "unverified"
  | "legacy_grace";

export type MetaLeadAccessStatus =
  | "unverified"
  | "pending_first_lead"
  | "verified_by_retrieval"
  | "verified_by_delivery"
  | "action_required";

export type MetaUserTokenCheck = {
  ok: boolean;
  code: string | null;
  message: string | null;
  retryable: boolean;
  grantedScopes: string[];
  missingScopes: string[];
  granularScopeTargets: Record<string, string[]>;
  tokenExpiresAt: string | null;
  dataAccessExpiresAt: string | null;
  tokenKind: string | null;
  userId: string | null;
  systemUserId: string | null;
};

export type MetaAppWebhookCheck = {
  ok: boolean;
  code: string | null;
  message: string | null;
  retryable: boolean;
  callbackUrl: string | null;
};

export type MetaPageConnectionHealth = {
  status: MetaConnectionHealthStatus;
  code: string | null;
  message: string | null;
  grantedScopes: string[];
  pageTasks: string[];
  subscribedFields: string[];
  tokenExpiresAt: string | null;
  dataAccessExpiresAt: string | null;
  tokenKind: string | null;
  leadAccessStatus: MetaLeadAccessStatus;
  lastLeadAccessVerifiedAt: string | null;
  checkedAt: string;
  nextCheckAt: string;
  details: {
    graph_version: string;
    app_webhook_verified: boolean;
    app_webhook_callback_verified: boolean;
    forms_probe: "ok" | "failed" | "not_run";
    lead_access_probe: "verified" | "pending_first_lead" | "failed" | "not_run";
    lead_access_note: "provider_does_not_expose_crm_assignment_api";
  };
};

export type PersistedMetaConnectionHealth = {
  status: MetaConnectionHealthStatus;
  leadAccessStatus: MetaLeadAccessStatus;
  stale?: boolean;
};

type DebugTokenResponse = {
  data?: {
    app_id?: string;
    is_valid?: boolean;
    type?: string;
    user_id?: string;
    profile_id?: string;
    system_user_id?: string;
    expires_at?: number;
    data_access_expires_at?: number;
    scopes?: string[];
    granular_scopes?: Array<{ scope?: string; target_ids?: string[] }>;
  };
};

type AppSubscriptionsResponse = {
  data?: Array<{
    object?: string;
    active?: boolean;
    callback_url?: string;
    fields?: Array<{ name?: string } | string>;
  }>;
};

type PageProbeResponse = {
  id?: string;
  name?: string;
  tasks?: string[];
};

type FormsProbeResponse = {
  data?: Array<{ id?: string; status?: string }>;
};

type LeadsProbeResponse = {
  data?: Array<{ id?: string }>;
};

type ExistingHealthRow = {
  page_id: string;
  health_status: MetaConnectionHealthStatus | null;
  lead_access_status: MetaLeadAccessStatus | null;
  last_lead_access_verified_at: string | null;
  last_success_at: string | null;
  consecutive_failures: number | null;
  credential_fingerprint: string | null;
};

const OPERATIONAL_HEALTH_STATUSES = new Set<MetaConnectionHealthStatus>([
  "ready",
  "degraded",
  "legacy_grace",
]);

export function metaCredentialFingerprint(
  pageAccessToken: string | null | undefined,
  userAccessToken: string | null | undefined,
): string {
  return createHash("sha256")
    .update(`${pageAccessToken ?? ""}\u001f${userAccessToken ?? ""}`, "utf8")
    .digest("hex");
}

function isoAfter(milliseconds: number): string {
  return new Date(Date.now() + milliseconds).toISOString();
}

function timestampFromUnix(value: number | undefined): string | null {
  if (!value || value <= 0) return null;
  return new Date(value * 1000).toISOString();
}

function appAccessToken(appId: string, appSecret: string): string {
  return `${appId}|${appSecret}`;
}

function safeHealthMessage(code: string): string {
  const messages: Record<string, string> = {
    token_invalid: "A autorização da Meta expirou ou foi revogada. Reconecte a conta.",
    token_not_durable:
      "A Meta devolveu uma autorização temporária. Reconecte pelo fluxo empresarial do MyChatCRM.",
    token_app_mismatch: "A autorização pertence a outro aplicativo Meta.",
    permission_missing:
      "A Meta não concedeu todas as permissões de Lead Ads. Reconecte e aprove todas as permissões.",
    app_webhook_missing:
      "O webhook global de Lead Ads do MyChatCRM não está configurado no aplicativo Meta.",
    app_webhook_callback_mismatch:
      "O webhook de Lead Ads da Meta aponta para um endereço diferente do MyChatCRM.",
    page_access_denied:
      "O usuário não possui acesso suficiente à Página selecionada.",
    forms_access_denied:
      "A Meta não permitiu consultar os formulários desta Página.",
    lead_access_denied:
      "A Meta não liberou o MyChatCRM no Acesso a Leads desta Página. No portfólio empresarial, atribua o CRM MyChatCRM à Página.",
    subscription_failed:
      "A Meta não confirmou a assinatura leadgen desta Página.",
    graph_temporarily_unavailable:
      "A Meta está temporariamente indisponível. O MyChatCRM tentará novamente sem desligar uma conexão saudável.",
    user_token_missing:
      "Reconecte a Meta para renovar a autorização desta Página.",
  };
  return messages[code] ?? `A conexão Meta precisa de verificação (${code}).`;
}

function normalizeWebhookUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    return `${url.protocol.toLowerCase()}//${hostname}${pathname}`;
  } catch {
    return null;
  }
}

function expectedWebhookCallbackUrl(): string {
  const configured = process.env.META_WEBHOOK_CALLBACK_URL?.trim();
  return configured || `${SITE_URL.replace(/\/$/, "")}/api/webhooks/meta`;
}

function tokenCheckFailure(params: {
  code: string;
  retryable?: boolean;
  grantedScopes?: string[];
  granularScopeTargets?: Record<string, string[]>;
  tokenExpiresAt?: string | null;
  dataAccessExpiresAt?: string | null;
  tokenKind?: string | null;
  userId?: string | null;
  systemUserId?: string | null;
}): MetaUserTokenCheck {
  return {
    ok: false,
    code: params.code,
    message: safeHealthMessage(params.code),
    retryable: params.retryable ?? false,
    grantedScopes: params.grantedScopes ?? [],
    missingScopes: [...REQUIRED_META_LEAD_SCOPES],
    granularScopeTargets: params.granularScopeTargets ?? {},
    tokenExpiresAt: params.tokenExpiresAt ?? null,
    dataAccessExpiresAt: params.dataAccessExpiresAt ?? null,
    tokenKind: params.tokenKind ?? null,
    userId: params.userId ?? null,
    systemUserId: params.systemUserId ?? null,
  };
}

function healthFromFailure(params: {
  code: string;
  retryable?: boolean;
  tokenCheck: MetaUserTokenCheck;
  appWebhookVerified: boolean;
  appWebhookCallbackVerified?: boolean;
  pageTasks?: string[];
  subscribedFields?: string[];
  formsProbe?: MetaPageConnectionHealth["details"]["forms_probe"];
  leadAccessStatus?: MetaLeadAccessStatus;
}): MetaPageConnectionHealth {
  const retryable = params.retryable ?? false;
  return {
    status: retryable ? "retrying" : "action_required",
    code: params.code,
    message: safeHealthMessage(params.code),
    grantedScopes: params.tokenCheck.grantedScopes,
    pageTasks: params.pageTasks ?? [],
    subscribedFields: params.subscribedFields ?? [],
    tokenExpiresAt: params.tokenCheck.tokenExpiresAt,
    dataAccessExpiresAt: params.tokenCheck.dataAccessExpiresAt,
    tokenKind: params.tokenCheck.tokenKind,
    leadAccessStatus:
      params.leadAccessStatus ??
      (params.code === "lead_access_denied" ? "action_required" : "unverified"),
    lastLeadAccessVerifiedAt: null,
    checkedAt: new Date().toISOString(),
    nextCheckAt: isoAfter(retryable ? 15 * 60_000 : 24 * 60 * 60_000),
    details: {
      graph_version: META_GRAPH_API_VERSION,
      app_webhook_verified: params.appWebhookVerified,
      app_webhook_callback_verified: params.appWebhookCallbackVerified ?? false,
      forms_probe: params.formsProbe ?? "not_run",
      lead_access_probe:
        params.code === "lead_access_denied" ? "failed" : "not_run",
      lead_access_note: "provider_does_not_expose_crm_assignment_api",
    },
  };
}

export function buildMetaConnectionFailureHealth(params: {
  code: string;
  retryable?: boolean;
  appWebhook?: MetaAppWebhookCheck;
}): MetaPageConnectionHealth {
  const tokenCheck = tokenCheckFailure({
    code: params.code,
    retryable: params.retryable,
  });
  return healthFromFailure({
    code: params.code,
    retryable: params.retryable,
    tokenCheck,
    appWebhookVerified: params.appWebhook?.ok ?? false,
    appWebhookCallbackVerified: params.appWebhook?.ok ?? false,
  });
}

export async function verifyMetaUserAccessToken(params: {
  userAccessToken: string;
  appId: string;
  appSecret: string;
  requireDurable?: boolean;
}): Promise<MetaUserTokenCheck> {
  try {
    const response = await metaGraphRequest<DebugTokenResponse>("/debug_token", {
      accessToken: appAccessToken(params.appId, params.appSecret),
      searchParams: { input_token: params.userAccessToken },
    });
    const data = response.data;
    const granularScopeTargets: Record<string, string[]> = {};
    for (const granular of data?.granular_scopes ?? []) {
      const scope = granular.scope?.trim();
      if (!scope) continue;
      granularScopeTargets[scope] = Array.from(
        new Set((granular.target_ids ?? []).map((target) => target.trim()).filter(Boolean)),
      ).sort();
    }
    const grantedScopes = Array.from(
      new Set(
        [
          ...(data?.scopes ?? []),
          ...Object.keys(granularScopeTargets),
        ]
          .map((scope) => scope.trim())
          .filter(Boolean),
      ),
    ).sort();
    const tokenExpiresAt = timestampFromUnix(data?.expires_at);
    const dataAccessExpiresAt = timestampFromUnix(data?.data_access_expires_at);
    const tokenKind = data?.type?.trim() || null;
    const userId = data?.user_id?.trim() || data?.profile_id?.trim() || null;
    const systemUserId = data?.system_user_id?.trim() || null;

    if (!data?.is_valid) {
      return tokenCheckFailure({
        code: "token_invalid",
        grantedScopes,
        granularScopeTargets,
        tokenExpiresAt,
        dataAccessExpiresAt,
        tokenKind,
        userId,
        systemUserId,
      });
    }
    if (data.app_id !== params.appId) {
      return tokenCheckFailure({
        code: "token_app_mismatch",
        grantedScopes,
        granularScopeTargets,
        tokenExpiresAt,
        dataAccessExpiresAt,
        tokenKind,
        userId,
        systemUserId,
      });
    }

    if (
      params.requireDurable &&
      data.expires_at &&
      data.expires_at > 0 &&
      data.expires_at * 1000 < Date.now() + 7 * 24 * 60 * 60_000
    ) {
      return tokenCheckFailure({
        code: "token_not_durable",
        grantedScopes,
        granularScopeTargets,
        tokenExpiresAt,
        dataAccessExpiresAt,
        tokenKind,
        userId,
        systemUserId,
      });
    }

    const granted = new Set(grantedScopes);
    const missingScopes = REQUIRED_META_LEAD_SCOPES.filter((scope) => !granted.has(scope));
    if (missingScopes.length > 0) {
      return {
        ...tokenCheckFailure({
          code: "permission_missing",
          grantedScopes,
          granularScopeTargets,
          tokenExpiresAt,
          dataAccessExpiresAt,
          tokenKind,
          userId,
          systemUserId,
        }),
        missingScopes,
        message: `${safeHealthMessage("permission_missing")} Ausentes: ${missingScopes.join(", ")}.`,
      };
    }

    return {
      ok: true,
      code: null,
      message: null,
      retryable: false,
      grantedScopes,
      missingScopes: [],
      granularScopeTargets,
      tokenExpiresAt,
      dataAccessExpiresAt,
      tokenKind,
      userId,
      systemUserId,
    };
  } catch (error) {
    const code = metaGraphErrorCode(error);
    return tokenCheckFailure({
      code,
      retryable: error instanceof MetaGraphRequestError && error.retryable,
    });
  }
}

export async function verifyMetaAppLeadgenWebhook(params: {
  appId: string;
  appSecret: string;
}): Promise<MetaAppWebhookCheck> {
  try {
    const response = await metaGraphRequest<AppSubscriptionsResponse>(
      `/${encodeURIComponent(params.appId)}/subscriptions`,
      {
        accessToken: appAccessToken(params.appId, params.appSecret),
        searchParams: { fields: "object,active,callback_url,fields" },
      },
    );
    const pageSubscription = (response.data ?? []).find(
      (subscription) => subscription.object?.toLowerCase() === "page",
    );
    const fields = (pageSubscription?.fields ?? []).map((field) =>
      typeof field === "string" ? field.toLowerCase() : field.name?.toLowerCase() ?? "",
    );
    if (!pageSubscription || pageSubscription.active === false || !fields.includes("leadgen")) {
      return {
        ok: false,
        code: "app_webhook_missing",
        message: safeHealthMessage("app_webhook_missing"),
        retryable: false,
        callbackUrl: pageSubscription?.callback_url ?? null,
      };
    }

    const callbackUrl = pageSubscription.callback_url?.trim() || null;
    const expected = normalizeWebhookUrl(expectedWebhookCallbackUrl());
    const actual = callbackUrl ? normalizeWebhookUrl(callbackUrl) : null;
    if (!expected || !actual || expected !== actual) {
      return {
        ok: false,
        code: "app_webhook_callback_mismatch",
        message: safeHealthMessage("app_webhook_callback_mismatch"),
        retryable: false,
        callbackUrl,
      };
    }

    return {
      ok: true,
      code: null,
      message: null,
      retryable: false,
      callbackUrl,
    };
  } catch (error) {
    const code = metaGraphErrorCode(error);
    return {
      ok: false,
      code,
      message: safeHealthMessage(code),
      retryable: error instanceof MetaGraphRequestError && error.retryable,
      callbackUrl: null,
    };
  }
}

export async function verifyMetaPageLeadConnection(params: {
  pageId: string;
  pageAccessToken: string;
  tokenCheck: MetaUserTokenCheck;
  appWebhook: MetaAppWebhookCheck;
}): Promise<MetaPageConnectionHealth> {
  if (!params.tokenCheck.ok) {
    return healthFromFailure({
      code: params.tokenCheck.code ?? "token_invalid",
      retryable: params.tokenCheck.retryable,
      tokenCheck: params.tokenCheck,
      appWebhookVerified: params.appWebhook.ok,
      appWebhookCallbackVerified: params.appWebhook.ok,
    });
  }
  if (!params.appWebhook.ok) {
    return healthFromFailure({
      code: params.appWebhook.code ?? "app_webhook_missing",
      retryable: params.appWebhook.retryable,
      tokenCheck: params.tokenCheck,
      appWebhookVerified: false,
      appWebhookCallbackVerified: false,
    });
  }

  let pageTasks: string[] = [];
  try {
    const page = await metaGraphRequest<PageProbeResponse>(
      `/${encodeURIComponent(params.pageId)}`,
      {
        accessToken: params.pageAccessToken,
        searchParams: { fields: "id,name,tasks" },
      },
    );
    if (page.id !== params.pageId) {
      return healthFromFailure({
        code: "page_access_denied",
        tokenCheck: params.tokenCheck,
        appWebhookVerified: true,
        appWebhookCallbackVerified: true,
      });
    }
    pageTasks = Array.isArray(page.tasks)
      ? page.tasks.filter((task) => typeof task === "string")
      : [];
  } catch (error) {
    const code = metaGraphErrorCode(error);
    return healthFromFailure({
      code: code === "permission_denied" ? "page_access_denied" : code,
      retryable: error instanceof MetaGraphRequestError && error.retryable,
      tokenCheck: params.tokenCheck,
      appWebhookVerified: true,
      appWebhookCallbackVerified: true,
    });
  }

  let forms: FormsProbeResponse["data"] = [];
  try {
    const response = await metaGraphRequest<FormsProbeResponse>(
      `/${encodeURIComponent(params.pageId)}/leadgen_forms`,
      {
        accessToken: params.pageAccessToken,
        searchParams: { fields: "id,status", limit: 25 },
      },
    );
    forms = response.data ?? [];
  } catch (error) {
    const code = metaGraphErrorCode(error);
    return healthFromFailure({
      code: code === "permission_denied" ? "forms_access_denied" : code,
      retryable: error instanceof MetaGraphRequestError && error.retryable,
      tokenCheck: params.tokenCheck,
      appWebhookVerified: true,
      appWebhookCallbackVerified: true,
      pageTasks,
      formsProbe: "failed",
    });
  }

  const subscription = await subscribePageToLeadgenWebhooks(
    params.pageId,
    params.pageAccessToken,
  );
  if (!subscription.ok) {
    const retryable =
      subscription.error?.includes("graph_temporarily_unavailable") ?? false;
    return healthFromFailure({
      code: "subscription_failed",
      retryable,
      tokenCheck: params.tokenCheck,
      appWebhookVerified: true,
      appWebhookCallbackVerified: true,
      pageTasks,
      subscribedFields: subscription.subscribedFields,
      formsProbe: "ok",
    });
  }

  let leadAccessStatus: MetaLeadAccessStatus = "pending_first_lead";
  let lastLeadAccessVerifiedAt: string | null = null;
  const formWithId =
    forms.find((form) => form.id && form.status === "ACTIVE") ??
    forms.find((form) => form.id);
  if (formWithId?.id) {
    try {
      await metaGraphRequest<LeadsProbeResponse>(
        `/${encodeURIComponent(formWithId.id)}/leads`,
        {
          accessToken: params.pageAccessToken,
          searchParams: { fields: "id", limit: 1 },
        },
      );
      leadAccessStatus = "verified_by_retrieval";
      lastLeadAccessVerifiedAt = new Date().toISOString();
    } catch (error) {
      const code = metaGraphErrorCode(error);
      return healthFromFailure({
        code: code === "permission_denied" ? "lead_access_denied" : code,
        retryable: error instanceof MetaGraphRequestError && error.retryable,
        tokenCheck: params.tokenCheck,
        appWebhookVerified: true,
        appWebhookCallbackVerified: true,
        pageTasks,
        subscribedFields: subscription.subscribedFields,
        formsProbe: "ok",
        leadAccessStatus:
          code === "permission_denied" ? "action_required" : "unverified",
      });
    }
  }

  const checkedAt = new Date().toISOString();
  const subscribedFields =
    subscription.subscribedFields ??
    META_PAGE_LEADGEN_WEBHOOK_FIELDS.split(",");
  return {
    status: "ready",
    code: null,
    message:
      leadAccessStatus === "pending_first_lead"
        ? "Configuração técnica concluída. O primeiro lead confirmará o acesso ponta a ponta."
        : null,
    grantedScopes: params.tokenCheck.grantedScopes,
    pageTasks,
    subscribedFields,
    tokenExpiresAt: params.tokenCheck.tokenExpiresAt,
    dataAccessExpiresAt: params.tokenCheck.dataAccessExpiresAt,
    tokenKind: params.tokenCheck.tokenKind,
    leadAccessStatus,
    lastLeadAccessVerifiedAt,
    checkedAt,
    nextCheckAt: isoAfter(24 * 60 * 60_000),
    details: {
      graph_version: META_GRAPH_API_VERSION,
      app_webhook_verified: true,
      app_webhook_callback_verified: true,
      forms_probe: "ok",
      lead_access_probe:
        leadAccessStatus === "verified_by_retrieval"
          ? "verified"
          : "pending_first_lead",
      lead_access_note: "provider_does_not_expose_crm_assignment_api",
    },
  };
}

function strongerLeadAccessStatus(
  previous: MetaLeadAccessStatus,
  next: MetaLeadAccessStatus,
): MetaLeadAccessStatus {
  // A current, authoritative denial must supersede historical evidence. This
  // prevents a formerly working connection from remaining green after the
  // customer removes the CRM from Meta Leads Access.
  if (next === "action_required") return next;
  if (previous === "verified_by_delivery") return previous;
  if (
    previous === "verified_by_retrieval" &&
    next !== "verified_by_delivery"
  ) {
    return previous;
  }
  return next;
}

export async function persistMetaConnectionHealth(params: {
  sb: SupabaseClient;
  tenantId: string;
  pageId: string;
  health: MetaPageConnectionHealth;
  expectedCredentialFingerprint?: string | null;
}): Promise<PersistedMetaConnectionHealth> {
  const { data: current, error: currentError } = await params.sb
    .from("meta_connections")
    .select(
      "page_id, health_status, lead_access_status, last_lead_access_verified_at, last_success_at, consecutive_failures, credential_fingerprint",
    )
    .eq("tenant_id", params.tenantId)
    .eq("page_id", params.pageId)
    .maybeSingle<ExistingHealthRow>();
  if (currentError) {
    throw new Error(`meta_connection_health_read_failed:${currentError.message}`);
  }
  if (!current) {
    throw new Error("meta_connection_health_row_not_found");
  }

  const previousStatus = current.health_status ?? "unverified";
  const previousLeadAccess = current.lead_access_status ?? "unverified";
  const expectedCredentialFingerprint =
    params.expectedCredentialFingerprint?.trim() || null;
  if (
    expectedCredentialFingerprint &&
    current.credential_fingerprint !== expectedCredentialFingerprint
  ) {
    return {
      status: previousStatus,
      leadAccessStatus: previousLeadAccess,
      stale: true,
    };
  }
  const preserveLastKnownGood =
    params.health.status === "retrying" &&
    OPERATIONAL_HEALTH_STATUSES.has(previousStatus);
  const effectiveStatus: MetaConnectionHealthStatus = preserveLastKnownGood
    ? "degraded"
    : params.health.status;
  const effectiveLeadAccess = preserveLastKnownGood
    ? previousLeadAccess
    : strongerLeadAccessStatus(previousLeadAccess, params.health.leadAccessStatus);
  const succeeded = params.health.status === "ready";
  const consecutiveFailures = succeeded
    ? 0
    : Math.max(0, current.consecutive_failures ?? 0) + 1;

  let updateQuery = params.sb
    .from("meta_connections")
    .update({
      health_status: effectiveStatus,
      health_code: preserveLastKnownGood
        ? params.health.code ?? "graph_temporarily_unavailable"
        : params.health.code,
      health_message: preserveLastKnownGood
        ? safeHealthMessage("graph_temporarily_unavailable")
        : params.health.message,
      granted_scopes: params.health.grantedScopes,
      page_tasks: params.health.pageTasks,
      subscribed_fields: params.health.subscribedFields,
      token_expires_at: params.health.tokenExpiresAt,
      data_access_expires_at: params.health.dataAccessExpiresAt,
      token_kind: params.health.tokenKind,
      lead_access_status: effectiveLeadAccess,
      last_lead_access_verified_at:
        params.health.lastLeadAccessVerifiedAt ??
        current.last_lead_access_verified_at,
      last_success_at: succeeded ? params.health.checkedAt : current.last_success_at,
      consecutive_failures: consecutiveFailures,
      next_health_check_at: params.health.nextCheckAt,
      last_verified_at: params.health.checkedAt,
      health_details: params.health.details,
      updated_at: params.health.checkedAt,
    })
    .eq("tenant_id", params.tenantId)
    .eq("page_id", params.pageId);
  if (current.credential_fingerprint) {
    updateQuery = updateQuery.eq(
      "credential_fingerprint",
      current.credential_fingerprint,
    );
  }
  const { data: updated, error } = await updateQuery
    .select("page_id")
    .maybeSingle<{ page_id: string }>();
  if (error) {
    throw new Error(`meta_connection_health_update_failed:${error.message}`);
  }
  if (!updated) {
    return {
      status: previousStatus,
      leadAccessStatus: previousLeadAccess,
      stale: true,
    };
  }
  return {
    status: effectiveStatus,
    leadAccessStatus: effectiveLeadAccess,
  };
}
