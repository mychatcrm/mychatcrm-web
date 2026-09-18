"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";

const ChatWidget = dynamic(() => import("@/components/chat/ChatWidget"), { ssr: false });

/** Hosts onde a aplicação é a MyChatCRM. Fora deles estamos numa página de cliente. */
function isAppHost(hostname: string): boolean {
  if (!hostname) return true;
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
  if (hostname === "127.0.0.1" || hostname === "::1") return true;
  if (hostname.endsWith(".vercel.app")) return true;

  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim() ?? "";
  const siteHost = configured
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
    .split("/")[0]
    ?.split(":")[0]
    ?.toLowerCase();

  const known = new Set(
    ["mychatcrm.com", "www.mychatcrm.com", "mychatcrm.com.br", "www.mychatcrm.com.br"].concat(
      siteHost ? [siteHost, siteHost.replace(/^www\./, "")] : [],
    ),
  );
  return known.has(hostname);
}

/**
 * O widget de chat só existe nas rotas onde o produto o usa. Mantê-lo fora de
 * `/dashboard` e `/admin` evita carregar framer-motion + efeitos no painel
 * (flash de sucesso + erro no cliente / hidratação).
 *
 * Também fica fora das páginas de captura dos clientes: ali o caminho é `/`,
 * que passaria no filtro de rota, mas o host é do cliente — o nosso chat na
 * landing dele roubaria o contacto que a campanha dele pagou para gerar.
 * A checagem de host é segura no cliente porque `ChatWidget` é `ssr: false` e
 * não existe na marcação do servidor.
 */
export function RootChatWidget() {
  const pathname = usePathname();
  if (!pathname) return null;
  if (pathname !== "/" && pathname !== "/planos") return null;
  if (typeof window !== "undefined" && !isAppHost(window.location.hostname.toLowerCase())) {
    return null;
  }
  return <ChatWidget />;
}
