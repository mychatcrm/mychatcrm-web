import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { allowDemoPasswordLogin, isVercelProduction } from "../demo-password-auth";

describe("demo-password-auth", () => {
  const saved = {
    ALLOW_DEMO_PASSWORD_AUTH: process.env.ALLOW_DEMO_PASSWORD_AUTH,
    VERCEL_ENV: process.env.VERCEL_ENV,
    NODE_ENV: process.env.NODE_ENV,
  };

  beforeEach(() => {
    delete process.env.ALLOW_DEMO_PASSWORD_AUTH;
    delete process.env.VERCEL_ENV;
    process.env.NODE_ENV = "test";
  });

  afterEach(() => {
    if (saved.ALLOW_DEMO_PASSWORD_AUTH === undefined) delete process.env.ALLOW_DEMO_PASSWORD_AUTH;
    else process.env.ALLOW_DEMO_PASSWORD_AUTH = saved.ALLOW_DEMO_PASSWORD_AUTH;
    if (saved.VERCEL_ENV === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = saved.VERCEL_ENV;
    process.env.NODE_ENV = saved.NODE_ENV;
  });

  it("isVercelProduction when VERCEL_ENV is production", () => {
    process.env.VERCEL_ENV = "production";
    expect(isVercelProduction()).toBe(true);
  });

  it("allowDemoPasswordLogin is false on Vercel production without override", () => {
    process.env.VERCEL_ENV = "production";
    expect(allowDemoPasswordLogin()).toBe(false);
  });

  it("allowDemoPasswordLogin is true when ALLOW_DEMO_PASSWORD_AUTH=1 even on Vercel production", () => {
    process.env.VERCEL_ENV = "production";
    process.env.ALLOW_DEMO_PASSWORD_AUTH = "1";
    expect(allowDemoPasswordLogin()).toBe(true);
  });

  it("allowDemoPasswordLogin is false when ALLOW_DEMO_PASSWORD_AUTH=0 on preview", () => {
    process.env.VERCEL_ENV = "preview";
    process.env.ALLOW_DEMO_PASSWORD_AUTH = "0";
    expect(allowDemoPasswordLogin()).toBe(false);
  });

  it("allowDemoPasswordLogin is true when NODE_ENV is test", () => {
    process.env.NODE_ENV = "test";
    expect(allowDemoPasswordLogin()).toBe(true);
  });

  it("allowDemoPasswordLogin is false for NODE_ENV=production without Vercel and without override", () => {
    process.env.NODE_ENV = "production";
    delete process.env.VERCEL_ENV;
    expect(allowDemoPasswordLogin()).toBe(false);
  });
});
