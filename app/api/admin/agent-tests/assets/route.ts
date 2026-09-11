import { NextResponse } from "next/server";
import { requireLabOwner, labError } from "@/lib/server/agent-test-lab/auth";
import { storeLabAsset, listLabAssets } from "@/lib/server/agent-test-lab/assets-store";
import { LAB_MAX_UPLOAD_BYTES } from "@/lib/agent-test-lab/contracts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  try { await requireLabOwner(request); return NextResponse.json({ assets: await listLabAssets() }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return labError(error); }
}

/**
 * Uploads one controlled test file. The size is checked before the body is read into
 * memory, and the bytes are checked against the extension's own signature after.
 */
export async function POST(request: Request) {
  try {
    await requireLabOwner(request);
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (declared > LAB_MAX_UPLOAD_BYTES + 8192) throw new Error("file_too_large");
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("file_missing");
    if (file.size > LAB_MAX_UPLOAD_BYTES) throw new Error("file_too_large");
    const factsRaw = form.get("expectedFacts");
    const expectedFacts = typeof factsRaw === "string" && factsRaw.trim()
      ? factsRaw.split("\n").map(line => line.trim()).filter(Boolean).slice(0, 20) : [];
    const asset = await storeLabAsset({
      bytes: new Uint8Array(await file.arrayBuffer()), filename: file.name, expectedFacts,
    });
    return NextResponse.json({ ok: true, asset }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return labError(error); }
}
