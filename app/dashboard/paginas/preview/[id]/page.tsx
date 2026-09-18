/**
 * Prévia do rascunho, dentro do painel.
 *
 * Existe porque publicar às cegas é o caminho mais curto para o cliente pôr no
 * ar uma página que ele nunca viu — e a primeira coisa que ele vai fazer com
 * ela é comprar tráfego.
 *
 * Vive sob `/dashboard/*`, então o middleware já validou sessão e papel antes
 * de chegar aqui; a checagem de tenant abaixo garante que um id de outra conta
 * não renderiza nada.
 */
import { notFound } from "next/navigation";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { LandingRenderer } from "@/components/landing/public/LandingRenderer";
import { resolveOrganizationRole } from "@/lib/organization-role";
import { getLandingPage, getLandingVersion } from "@/lib/server/landing-pages-db";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Prévia da página",
  robots: { index: false, follow: false },
};

export default async function LandingPreviewPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { versao?: string };
}) {
  const session = await getClientSessionFromCookies();
  if (!session) notFound();

  const role = resolveOrganizationRole(session);
  if (role !== "owner" && role !== "director") notFound();

  const page = await getLandingPage({ tenantId: session.tenantId, pageId: params.id }).catch(
    () => null,
  );
  if (!page) notFound();

  // Versão pedida, senão o rascunho, senão o que está no ar.
  const versionId = searchParams.versao?.trim() || page.draftVersionId || page.publishedVersionId;
  if (!versionId) notFound();

  const version = await getLandingVersion({ versionId }).catch(() => null);
  if (!version || version.pageId !== page.id) notFound();

  return (
    <div>
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 10,
          background: "#111827",
          color: "#f9fafb",
          padding: "8px 16px",
          fontSize: 13,
          fontFamily: "var(--font-inter,system-ui),system-ui,sans-serif",
          display: "flex",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <strong>Prévia</strong>
        <span style={{ opacity: 0.8 }}>
          {page.name} — versão {version.versionNo}
          {version.variantLabel ? ` (${version.variantLabel})` : ""}
        </span>
        <span style={{ opacity: 0.6 }}>
          O formulário não envia nada aqui.
        </span>
        <a href="/dashboard/paginas" style={{ marginLeft: "auto", color: "#fca5a5" }}>
          Voltar ao painel
        </a>
      </div>
      <LandingRenderer content={version.content} privacyHref="#" />
    </div>
  );
}
