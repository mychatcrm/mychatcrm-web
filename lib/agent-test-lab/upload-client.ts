"use client";
import { LAB_MAX_UPLOAD_BYTES } from "./contracts";

async function uploadRequest(body: unknown) {
  const response = await fetch("/api/admin/agent-tests/assets/upload", { method: "POST", credentials: "same-origin",
    cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.code ?? "upload_failed");
  return result;
}

export async function uploadLabFile(file: File, expectedFacts: string[] = []): Promise<{ id: string; filename: string }> {
  if (file.size < 1 || file.size > LAB_MAX_UPLOAD_BYTES) throw new Error("file_too_large");
  const { ticket } = await uploadRequest({ action: "prepare", filename: file.name, byteSize: file.size, expectedFacts });
  const { getSupabaseBrowserClient } = await import("@/lib/supabase/browser");
  const client = getSupabaseBrowserClient();
  if (!client) throw new Error("storage_unconfigured");
  const uploaded = await client.storage.from("agent-test-lab").uploadToSignedUrl(ticket.path, ticket.token,
    new Blob([file], { type: ticket.mimeType }), { contentType: ticket.mimeType, upsert: false });
  // An uncertain upload may actually exist. Server completion validates its bytes
  // instead of retrying the provider upload or creating another ticket.
  try { return (await uploadRequest({ action: "complete", id: ticket.id })).asset; }
  catch (error) { if (uploaded.error) throw new Error("asset_upload_unconfirmed"); throw error; }
}
