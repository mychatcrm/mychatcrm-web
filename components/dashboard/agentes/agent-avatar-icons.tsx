"use client";

import type { LucideIcon } from "lucide-react";
import { Bot, Building2, Headphones, Phone, Store, Target, UserRound, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";

export const AGENT_AVATAR_OPTIONS = [
  { id: "bot", label: "Assistente", Icon: Bot },
  { id: "user-f", label: "Perfil A", Icon: UserRound },
  { id: "user-m", label: "Perfil B", Icon: Headphones },
  { id: "wrench", label: "Suporte", Icon: Wrench },
  { id: "building", label: "Empresa", Icon: Building2 },
  { id: "store", label: "Vendas", Icon: Store },
  { id: "phone", label: "Contato", Icon: Phone },
  { id: "target", label: "Metas", Icon: Target },
] as const;

const agentAvatarIconMap: Record<string, LucideIcon> = Object.fromEntries(
  AGENT_AVATAR_OPTIONS.map((o) => [o.id, o.Icon]),
) as Record<string, LucideIcon>;

export function AgentAvatarGlyph({ avatar, className }: { avatar: string | undefined; className?: string }) {
  const key = avatar && agentAvatarIconMap[avatar] ? avatar : "bot";
  const Icon = agentAvatarIconMap[key] ?? Bot;
  return <Icon className={cn(className)} strokeWidth={1.75} aria-hidden />;
}
