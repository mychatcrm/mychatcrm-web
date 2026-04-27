"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";

const ChatWidget = dynamic(() => import("@/components/chat/ChatWidget"), { ssr: false });

/**
 * O widget de chat só existe nas rotas onde o produto o usa. Mantê-lo fora de
 * `/dashboard` e `/admin` evita carregar framer-motion + efeitos no painel
 * (flash de sucesso + erro no cliente / hidratação).
 */
export function RootChatWidget() {
  const pathname = usePathname();
  if (!pathname) return null;
  if (pathname !== "/" && pathname !== "/planos") return null;
  return <ChatWidget />;
}
