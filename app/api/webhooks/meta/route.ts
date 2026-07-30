import { waitUntil } from "@vercel/functions";
import { NextRequest, NextResponse } from "next/server";
import { verifyMetaSignature256 } from "@/lib/integrations/whatsapp-cloud";
import { resolveMetaAppSecret } from "@/lib/server/meta-app-secret";
import type { LeadgenValue } from "@/lib/server/meta-lead-ingest";
import {
  buildMetaLeadgenInboxEvent,
  enqueueMetaLeadgenEvents,
  processMetaLeadgenInbox,
  type MetaLeadgenInboxEvent,
} from "@/lib/server/meta-leadgen-inbox";
import { handleWhatsAppCloudWebhookPayload } from "@/lib/server/whatsapp-cloud-webhook-handler";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type MetaEntry = {
  id: string;
  time?: number;
  changes?: Array<{
    field: string;
    value: LeadgenValue;
  }>;
};

type MetaWebhookPayload = {
  object?: string;
  entry?: MetaEntry[];
};

const LEADGEN_WEBHOOK_FIELDS = new Set(["leadgen", "leadgen_update"]);

function newRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `meta-${Date.now()}`;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const params = req.nextUrl.searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  const expectedToken = process.env.META_WEBHOOK_VERIFY_TOKEN?.trim();
  if (!expectedToken) {
    console.error("[meta-webhook] META_WEBHOOK_VERIFY_TOKEN not set");
    return new NextResponse("Server misconfigured", { status: 500 });
  }

  if (mode === "subscribe" && token === expectedToken && challenge) {
    console.info("[meta-webhook] Webhook verified");
    return new NextResponse(challenge, { status: 200 });
  }

  console.warn("[meta-webhook] Verification failed", {
    mode,
    tokenPresent: Boolean(token),
  });
  return new NextResponse("Forbidden", { status: 403 });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const requestId = newRequestId();
  console.info("[meta-webhook] POST received", {
    requestId,
    contentLength: req.headers.get("content-length"),
    hasSignature: Boolean(req.headers.get("x-hub-signature-256")),
    userAgent: req.headers.get("user-agent"),
  });

  const rawBody = await req.text();

  const signatureBypass =
    process.env.NODE_ENV !== "production" &&
    process.env.WEBHOOK_SIGNATURE_BYPASS === "true";
  const appSecret = resolveMetaAppSecret();
  if (signatureBypass) {
    console.warn("[meta-webhook] WEBHOOK_SIGNATURE_BYPASS=true — skipping signature check (REMOVE FOR PRODUCTION)");
  } else if (appSecret) {
    const sig = req.headers.get("x-hub-signature-256");
    if (!verifyMetaSignature256(rawBody, sig, appSecret)) {
      console.warn("[meta-webhook] Invalid signature — ignoring", {
        requestId,
        hasSignatureHeader: Boolean(sig),
        appSecretConfigured: true,
        hint: "Confira META_APP_SECRET na Vercel = App Secret do app Meta (developers.facebook.com)",
      });
      return NextResponse.json({ ok: false, reason: "invalid_signature" }, { status: 401 });
    }
  } else {
    console.error("[meta-webhook] META_APP_SECRET not set — rejecting payload", { requestId });
    return NextResponse.json({ ok: false, reason: "server_misconfigured" }, { status: 503 });
  }

  let payload: MetaWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as MetaWebhookPayload;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 200 });
  }

  if (payload.object === "whatsapp_business_account") {
    // O app Meta único deste projeto entrega todos os objetos inscritos
    // (page + whatsapp_business_account) na mesma callback URL configurada
    // no dashboard — se for esta, processa como webhook da Cloud API em vez
    // de descartar (ver app/api/webhooks/whatsapp, que trata o mesmo payload
    // quando é essa a URL registada).
    console.info("[meta-webhook] WhatsApp Business Account payload accepted", { requestId });
    return handleWhatsAppCloudWebhookPayload(payload);
  }

  if (payload.object !== "page") {
    console.info("[meta-webhook] Ignored unhandled object", {
      requestId,
      object: payload.object ?? null,
    });
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const entryCount = payload.entry?.length ?? 0;
  const changeCount = (payload.entry ?? []).reduce((n, e) => n + (e.changes?.length ?? 0), 0);
  console.info("[meta-webhook] Page payload accepted", { requestId, entryCount, changeCount });

  const leadgenEvents = collectLeadgenEvents(payload.entry ?? [], requestId);
  if (leadgenEvents.length === 0) {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  let jobIds: string[];
  try {
    ({ jobIds } = await enqueueMetaLeadgenEvents({ events: leadgenEvents }));
  } catch (error) {
    console.error("[meta-webhook] Leadgen inbox persistence failed", {
      requestId,
      eventCount: leadgenEvents.length,
      error:
        error instanceof Error
          ? error.message
          : "meta_leadgen_inbox_persist_failed",
    });
    // Meta will retry this delivery. Never acknowledge a leadgen payload that
    // was not durably persisted.
    return NextResponse.json(
      { ok: false, reason: "leadgen_persist_failed" },
      { status: 503 },
    );
  }

  waitUntil(
    processMetaLeadgenInbox({
      jobIds,
      limit: Math.min(jobIds.length, 5),
    })
      .then((result) => {
        console.info("[meta-leadgen-inbox] inline_completed", {
          requestId,
          ...result,
        });
      })
      .catch((error) => {
        console.error("[meta-leadgen-inbox] inline_failed", {
          requestId,
          error:
            error instanceof Error
              ? error.message
              : "meta_leadgen_inbox_process_failed",
        });
      }),
  );

  return NextResponse.json(
    { ok: true, queued: jobIds.length },
    { status: 200 },
  );
}

function collectLeadgenEvents(
  entries: MetaEntry[],
  requestId: string,
): MetaLeadgenInboxEvent[] {
  const events: MetaLeadgenInboxEvent[] = [];
  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      if (!LEADGEN_WEBHOOK_FIELDS.has(change.field)) continue;
      const event = buildMetaLeadgenInboxEvent(change.field, change.value);
      if (!event) {
        console.warn("[meta-webhook] Invalid leadgen change ignored", {
          requestId,
          field: change.field,
          hasPageId: Boolean(change.value?.page_id),
          hasLeadgenId: Boolean(change.value?.leadgen_id),
        });
        continue;
      }
      console.info("[meta-webhook] Queueing leadgen change", {
        requestId,
        field: change.field,
        page_id: event.page_id,
        leadgen_id: event.leadgen_id,
      });
      events.push(event);
    }
  }
  return events;
}
