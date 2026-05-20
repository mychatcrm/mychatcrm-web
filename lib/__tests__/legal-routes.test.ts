import { describe, expect, it } from "vitest";
import {
  canonicalizeLegalPrivacyPath,
  canonicalizeLegalTermsPath,
  localizedLegalPrivacyHref,
  localizedLegalTermsHref,
} from "@/lib/legal-routes";

describe("legal-routes", () => {
  it("builds localized hrefs", () => {
    expect(localizedLegalPrivacyHref("pt-BR")).toBe("/politica-de-privacidade");
    expect(localizedLegalPrivacyHref("en")).toBe("/en/privacy-policy");
    expect(localizedLegalTermsHref("es")).toBe("/es/terminos-de-uso");
  });

  it("canonicalizes privacy aliases", () => {
    expect(canonicalizeLegalPrivacyPath("/en/privacy-policy")).toBe("/politica-de-privacidade");
    expect(canonicalizeLegalPrivacyPath("/privacidade")).toBe("/politica-de-privacidade");
  });

  it("canonicalizes terms aliases", () => {
    expect(canonicalizeLegalTermsPath("/en/terms-of-use")).toBe("/termos-de-uso");
    expect(canonicalizeLegalTermsPath("/termos")).toBe("/termos-de-uso");
  });
});
