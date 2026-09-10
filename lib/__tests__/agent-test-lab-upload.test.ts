import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ from: vi.fn(), storage: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServiceClient: () => ({ from: m.from, storage: { from: m.storage } }) }));
vi.mock("@/lib/server/agent-test-lab/auth", () => ({ labAudit: m.audit }));
import { completeLabAssetUpload, prepareLabAssetUpload, signLabAsset } from "@/lib/server/agent-test-lab/assets-store";
const id = "c8d27370-d4a0-494c-8138-43b7cf9d3d35";
const row = { id, owner_admin_id: "admin-renato-lagares", storage_path: `admin-renato-lagares/${id}.txt`,
  filename: "fixture.txt", byte_size: 5, expected_facts: [], upload_status: "pending" };
function chain(result: unknown) {
  const q: Record<string, any> = { then: (resolve: (r: unknown) => unknown) => Promise.resolve(result).then(resolve) };
  for (const method of ["insert", "update", "select", "eq", "gt", "order", "limit"]) q[method] = vi.fn(() => q);
  q.maybeSingle = vi.fn().mockResolvedValue(result);
  return q;
}
beforeEach(() => { vi.resetAllMocks(); m.audit.mockResolvedValue(undefined); });
describe("private direct laboratory uploads", () => {
  it("issues a non-overwritable, path-scoped ticket after persisting pending metadata", async () => {
    const q = chain({ error: null }); m.from.mockReturnValue(q);
    const sign = vi.fn().mockResolvedValue({ data: { token: "scoped-upload-token" } }); m.storage.mockReturnValue({ createSignedUploadUrl: sign });
    const ticket = await prepareLabAssetUpload({ filename: "fixture.txt", byteSize: 5, expectedFacts: [] });
    expect(q.insert).toHaveBeenCalledWith(expect.objectContaining({ upload_status: "pending", checksum: "pending", byte_size: 5 }));
    expect(sign).toHaveBeenCalledWith(ticket.path, { upsert: false });
    expect(ticket.path).toMatch(/^admin-renato-lagares\/[a-f0-9-]+\.txt$/);
    expect(Object.keys(ticket).sort()).toEqual(["byteSize", "id", "mimeType", "path", "token"]);
  });
  it("never signs a ticket if metadata persistence failed", async () => {
    m.from.mockReturnValue(chain({ error: { code: "unavailable" } }));
    await expect(prepareLabAssetUpload({ filename: "fixture.txt", byteSize: 5, expectedFacts: [] })).rejects.toThrow("asset_record_failed");
    expect(m.storage).not.toHaveBeenCalled();
  });
  it("verifies actual bytes and records a SHA256 before marking ready", async () => {
    const read = chain({ data: row }), write = chain({ data: [{ id }], error: null }); m.from.mockReturnValueOnce(read).mockReturnValue(write);
    m.storage.mockReturnValue({ download: vi.fn().mockResolvedValue({ data: new Blob(["hello"]) }) });
    expect(await completeLabAssetUpload(id)).toMatchObject({ id, filename: "fixture.txt", byteSize: 5 });
    expect(write.update).toHaveBeenCalledWith(expect.objectContaining({ upload_status: "ready", checksum: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824" }));
    expect(read.eq).toHaveBeenCalledWith("owner_admin_id", "admin-renato-lagares");
  });
  it.each([new Blob(["wrong size"]), new Blob([new Uint8Array([0, 0, 0, 0, 0])])])("rejects size/signature mismatches without publishing the file", async blob => {
    const write = chain({ error: null }); m.from.mockReturnValueOnce(chain({ data: row })).mockReturnValue(write);
    m.storage.mockReturnValue({ download: vi.fn().mockResolvedValue({ data: blob }) });
    await expect(completeLabAssetUpload(id)).rejects.toThrow();
    expect(write.update).toHaveBeenCalledWith({ upload_status: "rejected" });
    expect(m.audit).not.toHaveBeenCalled();
  });
  it("does not repeat a verified upload on completion retry", async () => {
    m.from.mockReturnValue(chain({ data: { ...row, upload_status: "ready" } }));
    await completeLabAssetUpload(id); expect(m.storage).not.toHaveBeenCalled();
  });
  it.each([{ ...row, storage_path: "another-owner/file.txt" }, { ...row, upload_status: "rejected" }])("rejects bad scope or a rejected upload", async data => {
    m.from.mockReturnValue(chain({ data })); await expect(completeLabAssetUpload(id)).rejects.toThrow(); expect(m.storage).not.toHaveBeenCalled();
  });
  it("does not sign pending, expired or missing files", async () => {
    const q = chain({ data: null }); m.from.mockReturnValue(q);
    await expect(signLabAsset(id)).rejects.toThrow("asset_missing");
    expect(q.eq).toHaveBeenCalledWith("upload_status", "ready"); expect(q.gt).toHaveBeenCalledWith("expires_at", expect.any(String));
    expect(m.storage).not.toHaveBeenCalled();
  });
  it("does not report completion when conditional persistence loses the race", async () => {
    m.from.mockReturnValueOnce(chain({ data: row })).mockReturnValue(chain({ data: [], error: null }));
    m.storage.mockReturnValue({ download: vi.fn().mockResolvedValue({ data: new Blob(["hello"]) }) });
    await expect(completeLabAssetUpload(id)).rejects.toThrow("asset_validation_concurrent_retry");
  });
});
