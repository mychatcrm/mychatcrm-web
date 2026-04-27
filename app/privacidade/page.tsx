import type { Metadata } from "next";
import Link from "next/link";
import { SITE_URL } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Política de Privacidade | MyChatCRM",
  description:
    "Veja como o MyChatCRM trata dados pessoais, cookies e informações da sua operação na política de privacidade.",
  alternates: { canonical: "/privacidade" },
  openGraph: {
    title: "Política de Privacidade | MyChatCRM",
    description:
      "Veja como o MyChatCRM trata dados pessoais, cookies e informações da sua operação na política de privacidade.",
    url: `${SITE_URL}/privacidade`,
    images: ["/og-image.png"],
  },
};

export default function PrivacidadePage() {
  return (
    <div className="min-h-screen bg-surface-base mx-auto max-w-3xl px-4 py-16 text-content">
      <Link href="/" className="text-sm text-primary hover:underline">
        ← Voltar
      </Link>
      <h1 className="mt-6 font-display text-3xl font-bold">Política de Privacidade</h1>
      <p className="mt-3 text-sm text-content-secondary">
        Texto jurídico placeholder. Substitua pelo documento oficial do MyChatCRM.
      </p>
    </div>
  );
}
