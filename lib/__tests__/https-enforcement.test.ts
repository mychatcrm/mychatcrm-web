import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { redirectHttpToHttpsInProduction } from "../https-enforcement";

describe("redirectHttpToHttpsInProduction", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv, NODE_ENV: "production" };
    delete process.env.DISABLE_HTTPS_REDIRECT;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns null for localhost", () => {
    const req = new NextRequest(new URL("http://localhost:3000/planos"));
    const res = redirectHttpToHttpsInProduction(req);
    expect(res).toBeNull();
  });

  it("returns 308 when x-forwarded-proto is http on production host", () => {
    const req = new NextRequest(new URL("http://mychatcrm.com.br/planos"), {
      headers: new Headers({ host: "mychatcrm.com.br", "x-forwarded-proto": "http" }),
    });
    const res = redirectHttpToHttpsInProduction(req);
    expect(res?.status).toBe(308);
    expect(res?.headers.get("location")).toMatch(/^https:\/\/mychatcrm\.com\.br\/planos/);
  });
});
