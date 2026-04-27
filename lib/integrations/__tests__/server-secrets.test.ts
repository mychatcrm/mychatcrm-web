import { describe, expect, it } from "vitest";
import { isUsableApiSecret } from "../server-secrets";

describe("server-secrets", () => {
  it("rejects empty and placeholders", () => {
    expect(isUsableApiSecret(undefined)).toBe(false);
    expect(isUsableApiSecret("")).toBe(false);
    expect(isUsableApiSecret("sua_key_aqui")).toBe(false);
    expect(isUsableApiSecret("changeme")).toBe(false);
  });

  it("accepts plausible keys", () => {
    expect(isUsableApiSecret("sk-proj-1234567890abcdef")).toBe(true);
    expect(isUsableApiSecret("sk-ant-api03-xxxxxxxx")).toBe(true);
  });
});
