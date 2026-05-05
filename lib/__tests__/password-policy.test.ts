import { describe, expect, it } from "vitest";
import { validatePassword } from "../password-policy";

describe("validatePassword", () => {
  it("rejects empty string", () => {
    const r = validatePassword("");
    expect(r.valid).toBe(false);
    expect(r.strength).toBe("empty");
  });

  it("rejects passwords shorter than 8 chars", () => {
    const r = validatePassword("abc123");
    expect(r.valid).toBe(false);
    expect(r.strength).toBe("weak");
  });

  it("accepts 8-char password and classifies strength", () => {
    const r = validatePassword("abcdefgh");
    expect(r.valid).toBe(true);
    expect(r.strength).toBeDefined();
  });

  it("scores a complex password as strong", () => {
    const r = validatePassword("Tr0ub4dor&3!");
    expect(r.valid).toBe(true);
    expect(r.strength).toBe("strong");
  });

  it("scores a simple long password as fair", () => {
    const r = validatePassword("abcdefghi1");
    expect(r.valid).toBe(true);
    expect(["fair", "strong"]).toContain(r.strength);
  });
});
