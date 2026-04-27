import type { Metadata } from "next";
import Script from "next/script";
import { redirect } from "next/navigation";
import { PANEL_THEME_BOOT_SCRIPT } from "@/lib/panel-theme-boot-script";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";
import { getPanelAppearanceFromCookies } from "@/lib/panel-theme-server";

export const metadata: Metadata = {
  title: "Painel do cliente | MyChatCRM",
  description: "Gerencie chatbot, CRM Kanban, agenda e integrações do MyChatCRM.",
  robots: { index: false, follow: false },
  alternates: { canonical: "/dashboard" },
};

/**
 * Layout persistente do painel do cliente.
 *
 * PanelAppearanceProvider (dentro de DashboardShell) fica AQUI — e não
 * dentro da página — para que nunca desmonte/remonte na troca de rota.
 * Isso elimina o flash de dark→light que ocorria quando o React substituía
 * a árvore da página ao navegar entre `/dashboard` e `/dashboard/[slug]`.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getClientSessionFromCookies();
  if (!session) redirect("/login?from=/dashboard");

  const initialPanelTheme = getPanelAppearanceFromCookies();

  return (
    <>
      {/* beforeInteractive: alinha html/body antes da hidratação (evita flash no primeiro carregamento) */}
      <Script
        id="mychatcrm-dashboard-panel-theme-boot"
        strategy="beforeInteractive"
        dangerouslySetInnerHTML={{ __html: PANEL_THEME_BOOT_SCRIPT }}
      />
      <DashboardShell session={session} initialPanelTheme={initialPanelTheme}>
        {children}
      </DashboardShell>
    </>
  );
}
