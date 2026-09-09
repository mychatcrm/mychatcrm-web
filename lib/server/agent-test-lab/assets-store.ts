import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { parseLabAssetMetadata, validateLabFileSignature } from "@/lib/agent-test-lab/assets";
import { LAB_OWNER_ID, assertLabUuid } from "@/lib/agent-test-lab/policy";
import { labAudit } from "./auth";

export const LAB_ASSET_BUCKET = "agent-test-lab";
/** Long enough for the provider to fetch the file, short enough to be useless later. */
const SIGNED_URL_SECONDS = 300;

export type LabStoredAsset = {
  id: string; kind: string; mimeType: string; filename: string; byteSize: number; expectedFacts: string[];
};

/**
 * Stores one controlled test file. The extension is checked against an allowlist and
 * then against the file's own signature, so a renamed executable or an HTML file
 * dressed as a document is refused before it ever reaches storage.
 */
export async function storeLabAsset(params: {
  bytes: Uint8Array; filename: string; expectedFacts: unknown; runId?: string | null;
}): Promise<LabStoredAsset> {
  const meta = parseLabAssetMetadata({
    filename: params.filename, byteSize: params.bytes.byteLength, expectedFacts: params.expectedFacts,
  });
  if (!validateLabFileSignature(params.bytes, meta.extension)) throw new Error("file_signature_mismatch");
  if (params.runId) assertLabUuid(params.runId);

  const id = randomUUID();
  const storagePath = `${LAB_OWNER_ID}/${id}.${meta.extension}`;
  const checksum = createHash("sha256").update(params.bytes).digest("hex");
  const sb = createSupabaseServiceClient();

  const uploaded = await sb.storage.from(LAB_ASSET_BUCKET)
    .upload(storagePath, params.bytes, { contentType: meta.mimeType, upsert: false });
  if (uploaded.error) throw new Error("asset_upload_failed");

  const saved = await sb.from("agent_test_lab_assets").insert({
    id, owner_admin_id: LAB_OWNER_ID, run_id: params.runId ?? null, storage_path: storagePath,
    kind: meta.kind, mime_type: meta.mimeType, byte_size: meta.byteSize, filename: meta.filename,
    expected_facts: meta.expectedFacts, checksum,
  });
  if (saved.error) {
    // Never leave an orphan object behind a failed row.
    await sb.storage.from(LAB_ASSET_BUCKET).remove([storagePath]).catch(() => undefined);
    throw new Error("asset_record_failed");
  }
  await labAudit("asset.stored", id);
  return { id, kind: meta.kind, mimeType: meta.mimeType, filename: meta.filename, byteSize: meta.byteSize, expectedFacts: meta.expectedFacts };
}

/** A short-lived URL the provider can fetch; the bucket itself stays private. */
export async function signLabAsset(assetId: string): Promise<{ url: string; asset: LabStoredAsset }> {
  assertLabUuid(assetId);
  const sb = createSupabaseServiceClient();
  const row = await sb.from("agent_test_lab_assets")
    .select("id,storage_path,kind,mime_type,filename,byte_size,expected_facts")
    .eq("id", assetId).eq("owner_admin_id", LAB_OWNER_ID).maybeSingle();
  if (row.error) throw new Error("asset_read_failed");
  if (!row.data) throw new Error("asset_missing");
  const signed = await sb.storage.from(LAB_ASSET_BUCKET).createSignedUrl(String(row.data.storage_path), SIGNED_URL_SECONDS);
  if (signed.error || !signed.data?.signedUrl) throw new Error("asset_sign_failed");
  return {
    url: signed.data.signedUrl,
    asset: {
      id: String(row.data.id), kind: String(row.data.kind), mimeType: String(row.data.mime_type),
      filename: String(row.data.filename), byteSize: Number(row.data.byte_size),
      expectedFacts: (row.data.expected_facts ?? []) as string[],
    },
  };
}

export async function listLabAssets(): Promise<LabStoredAsset[]> {
  const rows = await createSupabaseServiceClient().from("agent_test_lab_assets")
    .select("id,kind,mime_type,filename,byte_size,expected_facts")
    .eq("owner_admin_id", LAB_OWNER_ID).order("created_at", { ascending: false }).limit(200);
  if (rows.error) throw new Error("assets_read_failed");
  return (rows.data ?? []).map(row => ({
    id: String(row.id), kind: String(row.kind), mimeType: String(row.mime_type),
    filename: String(row.filename), byteSize: Number(row.byte_size),
    expectedFacts: (row.expected_facts ?? []) as string[],
  }));
}
