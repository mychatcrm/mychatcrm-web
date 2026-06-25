import { describe, expect, it, vi } from "vitest";
import {
  confirmAccountPhoneVerification,
  hashPhoneVerificationCode,
  requestAccountPhoneVerification,
} from "@/lib/server/account-phone-verification";

process.env.PHONE_VERIFICATION_PEPPER = "test-phone-pepper";

type Row = {
  id: string;
  tenant_id: string;
  member_id: string;
  phone_type: string;
  phone: string;
  code_hash: string;
  status: string;
  attempts: number;
  expires_at: string;
  created_at: string;
  updated_at?: string;
  metadata?: Record<string, unknown>;
};

function createFakeSupabase(rows: Row[] = []) {
  let seq = rows.length;

  function runSelect(filters: Array<{ key: string; value: unknown }>, inFilters: Array<{ key: string; values: unknown[] }>) {
    return rows.filter((row) => {
      const eqOk = filters.every((filter) => (row as unknown as Record<string, unknown>)[filter.key] === filter.value);
      const inOk = inFilters.every((filter) => filter.values.includes((row as unknown as Record<string, unknown>)[filter.key]));
      return eqOk && inOk;
    });
  }

  return {
    rows,
    from() {
      const filters: Array<{ key: string; value: unknown }> = [];
      const inFilters: Array<{ key: string; values: unknown[] }> = [];
      let mode: "select" | "update" | "insert" = "select";
      let patch: Record<string, unknown> = {};
      let inserted: Row | null = null;
      let headCount = false;

      const builder = {
        select(_columns?: string, options?: { count?: string; head?: boolean }) {
          headCount = Boolean(options?.head);
          return builder;
        },
        eq(key: string, value: unknown) {
          filters.push({ key, value });
          return builder;
        },
        gte() {
          return builder;
        },
        in(key: string, values: unknown[]) {
          inFilters.push({ key, values });
          if (mode === "update") {
            runSelect(filters, inFilters).forEach((row) => Object.assign(row, patch));
            return Promise.resolve({ data: null, error: null });
          }
          return Promise.resolve({ count: runSelect(filters, inFilters).length, error: null });
        },
        update(nextPatch: Record<string, unknown>) {
          mode = "update";
          patch = nextPatch;
          return builder;
        },
        insert(payload: Record<string, unknown>) {
          mode = "insert";
          inserted = {
            id: `code-${++seq}`,
            tenant_id: String(payload.tenant_id),
            member_id: String(payload.member_id),
            phone_type: String(payload.phone_type),
            phone: String(payload.phone),
            code_hash: String(payload.code_hash),
            status: String(payload.status),
            attempts: 0,
            expires_at: String(payload.expires_at),
            created_at: new Date().toISOString(),
            metadata: payload.metadata as Record<string, unknown>,
          };
          rows.push(inserted);
          return builder;
        },
        order() {
          return builder;
        },
        limit() {
          return builder;
        },
        single() {
          return Promise.resolve({ data: inserted ? { id: inserted.id } : null, error: null });
        },
        maybeSingle() {
          const [row] = runSelect(filters, inFilters).sort((a, b) => b.created_at.localeCompare(a.created_at));
          return Promise.resolve({ data: row ?? null, error: null });
        },
        then(resolve: (value: unknown) => void) {
          if (mode === "update") {
            runSelect(filters, inFilters).forEach((row) => Object.assign(row, patch));
            return Promise.resolve({ data: null, error: null }).then(resolve);
          }
          if (headCount) {
            return Promise.resolve({ count: runSelect(filters, inFilters).length, error: null }).then(resolve);
          }
          return Promise.resolve({ data: runSelect(filters, inFilters), error: null }).then(resolve);
        },
      };

      return builder;
    },
  };
}

describe("account phone verification", () => {
  it("hashes codes without storing the raw value", () => {
    const hash = hashPhoneVerificationCode({
      tenantId: "tenant-1",
      memberId: "member-1",
      phoneType: "personal",
      phone: "5562999991111",
      code: "123456",
    });

    expect(hash).toHaveLength(64);
    expect(hash).not.toContain("123456");
  });

  it("sends a code and only applies the phone after the correct code", async () => {
    const sb = createFakeSupabase();
    let sentCode = "";
    const send = vi.fn(async (_phone: string, message: string) => {
      sentCode = message.match(/\d{6}/)?.[0] ?? "";
      return { ok: true as const };
    });

    const requested = await requestAccountPhoneVerification({
      tenantId: "tenant-1",
      memberId: "member-1",
      phoneType: "personal",
      rawPhone: "(62) 99999-1111",
      requestedByEmail: "user@example.com",
      sb: sb as never,
      send: send as never,
    });

    expect(requested.ok).toBe(true);
    expect(send).toHaveBeenCalledOnce();
    expect(sb.rows[0]?.status).toBe("sent");

    const applyVerifiedPhone = vi.fn(async () => undefined);
    const wrong = await confirmAccountPhoneVerification({
      tenantId: "tenant-1",
      memberId: "member-1",
      phoneType: "personal",
      code: "000000",
      sb: sb as never,
      applyVerifiedPhone,
    });

    expect(wrong.ok).toBe(false);
    expect(applyVerifiedPhone).not.toHaveBeenCalled();

    const confirmed = await confirmAccountPhoneVerification({
      tenantId: "tenant-1",
      memberId: "member-1",
      phoneType: "personal",
      code: sentCode,
      sb: sb as never,
      applyVerifiedPhone,
    });

    expect(confirmed.ok).toBe(true);
    expect(applyVerifiedPhone).toHaveBeenCalledWith("5562999991111");
    expect(sb.rows[0]?.status).toBe("consumed");
  });
});
