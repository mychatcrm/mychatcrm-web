import { describe, expect, it } from "vitest";
import { resolveUnlocalizedPublicPath } from "@/lib/unlocalized-public-paths";

describe("resolveUnlocalizedPublicPath", () => {
  it("accepts canonical paths without locale prefix", () => {
    expect(resolveUnlocalizedPublicPath("/reset-password")).toBe("/reset-password");
    expect(resolveUnlocalizedPublicPath("/politica-de-privacidade")).toBe("/politica-de-privacidade");
    expect(resolveUnlocalizedPublicPath("/termos-de-uso")).toBe("/termos-de-uso");
  });

  it("strips locale prefix from localized URLs", () => {
    expect(resolveUnlocalizedPublicPath("/pt-BR/politica-de-privacidade")).toBe("/politica-de-privacidade");
    expect(resolveUnlocalizedPublicPath("/en/termos-de-uso")).toBe("/termos-de-uso");
    expect(resolveUnlocalizedPublicPath("/es/reset-password")).toBe("/reset-password");
  });

  it("returns null for unrelated paths", () => {
    expect(resolveUnlocalizedPublicPath("/pt-BR/login")).toBeNull();
    expect(resolveUnlocalizedPublicPath("/dashboard")).toBeNull();
  });
});
