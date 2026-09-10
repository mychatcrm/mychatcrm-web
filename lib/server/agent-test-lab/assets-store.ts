import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { parseLabAssetMetadata, validateLabFileSignature } from "@/lib/agent-test-lab/assets";
import { LAB_OWNER_ID, assertLabUuid } from "@/lib/agent-test-lab/policy";
import { labAudit } from "./auth";

export const LAB_ASSET_BUCKET = "agent-test-lab";
/** Delete the private object first. Failed removal retains the durable row for retry. */
export async function purgeLabExpiredAssets(): Promise<number> {
  const sb = createSupabaseServiceClient();
  const expired = await sb.from("agent_test_lab_assets").select("id,storage_path")
    .lte("expires_at", new Date().toISOString()).order("expires_at").limit(100);
  if (expired.error) throw new Error("asset_retention_read_failed");
  let removed = 0;
  for (const row of expired.data ?? []) {
    if (!String(row.storage_path).startsWith(`${LAB_OWNER_ID}/`)) throw new Error("asset_retention_scope_invalid");
    const object = await sb.storage.from(LAB_ASSET_BUCKET).remove([String(row.storage_path)]);
    if (object.error) throw new Error("asset_retention_remove_failed");
    const record = await sb.from("agent_test_lab_assets").delete().eq("id", row.id);
    if (record.error) throw new Error("asset_retention_record_failed");
    removed += 1;
  }
  return removed;
}
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
    .eq("id", assetId).eq("owner_admin_id", LAB_OWNER_ID).eq("upload_status", "ready")
    .gt("expires_at", new Date().toISOString()).maybeSingle();
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
    .eq("owner_admin_id", LAB_OWNER_ID).eq("upload_status", "ready")
    .gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(200);
  if (rows.error) throw new Error("assets_read_failed");
  return (rows.data ?? []).map(row => ({
    id: String(row.id), kind: String(row.kind), mimeType: String(row.mime_type),
    filename: String(row.filename), byteSize: Number(row.byte_size),
    expectedFacts: (row.expected_facts ?? []) as string[],
  }));
}

/** The browser uploads directly to private Storage, not through Vercel's body limit. */
export async function prepareLabAssetUpload(input: unknown) {
  const meta = parseLabAssetMetadata(input);
  const id = randomUUID(), path = `${LAB_OWNER_ID}/${id}.${meta.extension}`;
  const sb = createSupabaseServiceClient();
  const saved = await sb.from("agent_test_lab_assets").insert({ id, owner_admin_id: LAB_OWNER_ID,
    storage_path: path, kind: meta.kind, mime_type: meta.mimeType, byte_size: meta.byteSize,
    filename: meta.filename, expected_facts: meta.expectedFacts, checksum: "pending", upload_status: "pending",
    // Keep pending objects beyond the signed token's two-hour validity. Otherwise
    // cleanup could remove an object while its token still permits re-creation.
    expires_at: new Date(Date.now() + 3 * 3600000).toISOString() });
  if (saved.error) throw new Error("asset_record_failed");
  const signed = await sb.storage.from(LAB_ASSET_BUCKET).createSignedUploadUrl(path, { upsert: false });
  if (signed.error || !signed.data?.token) throw new Error("asset_upload_sign_failed");
  await labAudit("asset.upload_prepared", id);
  return { id, path, token: signed.data.token, mimeType: meta.mimeType, byteSize: meta.byteSize };
}

/** A signed upload is not trusted until its actual bytes are verified on the server. */
export async function completeLabAssetUpload(id: string): Promise<LabStoredAsset> {
  assertLabUuid(id);
  const sb = createSupabaseServiceClient();
  const found = await sb.from("agent_test_lab_assets").select("*").eq("id", id).eq("owner_admin_id", LAB_OWNER_ID)
    .gt("expires_at", new Date().toISOString()).maybeSingle();
  if (found.error || !found.data) throw new Error("asset_missing");
  const row = found.data;
  const meta = parseLabAssetMetadata({ filename: row.filename, byteSize: Number(row.byte_size), expectedFacts: row.expected_facts });
  if (row.storage_path !== `${LAB_OWNER_ID}/${id}.${meta.extension}`) throw new Error("asset_path_invalid");
  if (row.upload_status === "rejected") throw new Error("asset_validation_rejected");
  if (row.upload_status !== "ready") {
    const downloaded = await sb.storage.from(LAB_ASSET_BUCKET).download(row.storage_path);
    if (downloaded.error || !downloaded.data) throw new Error("asset_upload_not_found");
    if (downloaded.data.size !== meta.byteSize) {
      await sb.from("agent_test_lab_assets").update({ upload_status: "rejected" }).eq("id", id).eq("upload_status", "pending");
      throw new Error("asset_size_mismatch");
    }
    const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
    if (!validateLabFileSignature(bytes, meta.extension)) {
      await sb.from("agent_test_lab_assets").update({ upload_status: "rejected" }).eq("id", id).eq("upload_status", "pending");
      throw new Error("file_signature_mismatch");
    }
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const saved = await sb.from("agent_test_lab_assets").update({ upload_status: "ready", checksum,
      expires_at: new Date(Date.now() + 30 * 86400000).toISOString() }).eq("id", id).eq("upload_status", "pending")
      .select("id");
    if (saved.error) throw new Error("asset_validation_save_failed");
    if (!saved.data?.length) throw new Error("asset_validation_concurrent_retry");
    await labAudit("asset.upload_verified", id);
  }
  return { id, kind: meta.kind, mimeType: meta.mimeType, filename: meta.filename, byteSize: meta.byteSize, expectedFacts: meta.expectedFacts };
}
