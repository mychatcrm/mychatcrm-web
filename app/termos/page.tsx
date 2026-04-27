import type { Metadata } from "next";
import Link from "next/link";
import { SITE_URL } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Termos de Uso | MyChatCRM",
  description:
    "Consulte os termos de uso da plataforma MyChatCRM para acesso, contratação e uso dos serviços.",
  alternates: { canonical: "/termos" },
  openGraph: {
    title: "Termos de Uso | MyChatCRM",
    description:
      "Consulte os termos de uso da plataforma MyChatCRM para acesso, contratação e uso dos serviços.",
    url: `${SITE_URL}/termos`,
    images: ["/og-image.png"],
  },
};

export default function TermosPage() {
  return (
    <div className="min-h-screen bg-surface-base mx-auto max-w-3xl px-4 py-16 text-content">
      <Link href="/" className="text-sm text-primary hover:underline">
        ← Voltar
      </Link>
      <h1 className="mt-6 font-display text-3xl font-bold">Termos de Uso</h1>
      <p className="mt-3 text-sm text-content-secondary">
        Texto jurídico placeholder. Substitua pelo documento oficial do MyChatCRM.
      </p>
    </div>
  );
}
