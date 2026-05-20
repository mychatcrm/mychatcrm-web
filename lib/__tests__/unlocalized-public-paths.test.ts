import { describe, expect, it } from "vitest";
import { resolveUnlocalizedPublicPath } from "@/lib/unlocalized-public-paths";

describe("resolveUnlocalizedPublicPath", () => {
  it("accepts canonical paths without locale prefix", () => {
    expect(resolveUnlocalizedPublicPath("/reset-password")).toBe("/reset-password");
    expect(resolveUnlocalizedPublicPath("/politica-de-privacidade")).toBe("/politica-de-privacidade");
    expect(resolveUnlocalizedPublicPath("/termos-de-uso")).toBe("/termos-de-uso");
  });

  it("strips only pt-BR locale prefix to canonical URLs", () => {
    expect(resolveUnlocalizedPublicPath("/pt-BR/politica-de-privacidade")).toBe("/politica-de-privacidade");
    expect(resolveUnlocalizedPublicPath("/pt-BR/reset-password")).toBe("/reset-password");
  });

  it("does not strip en/es legal slugs (handled by next-intl)", () => {
    expect(resolveUnlocalizedPublicPath("/en/privacy-policy")).toBeNull();
    expect(resolveUnlocalizedPublicPath("/en/terms-of-use")).toBeNull();
    expect(resolveUnlocalizedPublicPath("/es/politica-de-privacidad")).toBeNull();
  });

  it("returns null for unrelated paths", () => {
    expect(resolveUnlocalizedPublicPath("/pt-BR/login")).toBeNull();
    expect(resolveUnlocalizedPublicPath("/dashboard")).toBeNull();
  });
});
