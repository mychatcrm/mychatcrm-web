import { NextRequest, NextResponse } from "next/server";
import { verifyMetaSignature256 } from "@/lib/integrations/whatsapp-cloud";
import { resolveMetaAppSecret } from "@/lib/server/meta-app-secret";
import { processMetaLeadgenEvent, type LeadgenValue } from "@/lib/server/meta-lead-ingest";

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

  console.warn("[meta-webhook] Verification failed", { mode, token });
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

  const signatureBypass = process.env.WEBHOOK_SIGNATURE_BYPASS === "true";
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
      return NextResponse.json({ ok: false, reason: "invalid_signature" }, { status: 200 });
    }
  } else {
    console.warn("[meta-webhook] META_APP_SECRET not set — skipping signature check");
  }

  let payload: MetaWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as MetaWebhookPayload;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 200 });
  }

  if (payload.object !== "page") {
    console.info("[meta-webhook] Ignored non-page object", {
      requestId,
      object: payload.object ?? null,
    });
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const entryCount = payload.entry?.length ?? 0;
  const changeCount = (payload.entry ?? []).reduce((n, e) => n + (e.changes?.length ?? 0), 0);
  console.info("[meta-webhook] Page payload accepted", { requestId, entryCount, changeCount });

  await processLeadgenEntries(payload.entry ?? [], requestId);

  return NextResponse.json({ ok: true }, { status: 200 });
}

async function processLeadgenEntries(entries: MetaEntry[], requestId: string): Promise<void> {
  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      if (!LEADGEN_WEBHOOK_FIELDS.has(change.field)) continue;
      console.info("[meta-webhook] Processing leadgen change", {
        requestId,
        field: change.field,
        page_id: change.value?.page_id,
        leadgen_id: change.value?.leadgen_id,
      });
      await processMetaLeadgenEvent(change.value).catch((err) => {
        console.error("[meta-webhook] Error processing leadgen event", {
          requestId,
          field: change.field,
          leadgen_id: change.value?.leadgen_id,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
  }
}
