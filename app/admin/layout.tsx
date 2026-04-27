import type { Metadata } from "next";
import Script from "next/script";
import { PANEL_THEME_BOOT_SCRIPT } from "@/lib/panel-theme-boot-script";
import { AdminShell } from "@/components/admin/AdminShell";
import { getAdminSessionFromCookies } from "@/lib/admin-auth";
import { getPanelAppearanceFromCookies } from "@/lib/panel-theme-server";

export const metadata: Metadata = {
  title: "Painel administrativo | MyChatCRM",
  robots: { index: false, follow: false },
  alternates: { canonical: "/admin" },
};

/**
 * Layout persistente do painel administrativo.
 *
 * AdminShell (com PanelAppearanceProvider) fica aqui — e não dentro da
 * página — para que o Provider nunca desmonte ao trocar de rota no admin,
 * eliminando o flash de dark mode durante a navegação.
 *
 * Quando não há sessão (ex.: rota /admin/login), apenas injeta o boot
 * script e renderiza os children sem o shell autenticado — evita loop de
 * redirect já que /admin/login está dentro deste escopo de layout.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getAdminSessionFromCookies();
  const initialPanelTheme = getPanelAppearanceFromCookies();

  const script = (
    <Script
      id="mychatcrm-admin-panel-theme-boot"
      strategy="beforeInteractive"
      dangerouslySetInnerHTML={{ __html: PANEL_THEME_BOOT_SCRIPT }}
    />
  );

  // Sem sessão: middleware já redireciona para /admin/login; aqui apenas
  // renderizamos children sem o shell (caso de /admin/login ou edge case).
  if (!session) {
    return (
      <>
        {script}
        {children}
      </>
    );
  }

  return (
    <>
      {script}
      <AdminShell session={session} initialPanelTheme={initialPanelTheme}>
        {children}
      </AdminShell>
    </>
  );
}
