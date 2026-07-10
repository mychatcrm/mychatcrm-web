"use client";

import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  Bell,
  Building2,
  Bot,
  Calendar,
  CircleDollarSign,
  ClipboardList,
  CreditCard,
  FileText,
  Handshake,
  Key,
  Layers,
  LayoutDashboard,
  LifeBuoy,
  LineChart,
  Link2,
  MessagesSquare,
  Megaphone,
  Package,
  PhoneCall,
  ScrollText,
  Send,
  Settings,
  Waypoints,
  Shield,
  TicketPercent,
  TrendingDown,
  UserCog,
  UserPlus,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

const dashboardNavIcons: Record<string, LucideIcon> = {
  overview: LayoutDashboard,
  crm: Users,
  "ofertas-ativas": PhoneCall,
  agentes: Bot,
  conversas: MessagesSquare,
  "integracoes-leads": Waypoints,
  agenda: Calendar,
  disparos: Send,
  lembretes: Bell,
  integracoes: Link2,
  configuracoes: Settings,
  suporte: LifeBuoy,
};

const adminNavIcons: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  analytics: LineChart,
  clientes: Users,
  leads: UserPlus,
  inadimplentes: AlertTriangle,
  cancelamentos: ClipboardList,
  planos: Package,
  enterprise: Building2,
  cupons: TicketPercent,
  parcerias: Handshake,
  features: Layers,
  financeiro: CircleDollarSign,
  faturas: FileText,
  pagamentos: CreditCard,
  churn: TrendingDown,
  suporte: LifeBuoy,
  comunicados: Megaphone,
  notificacoes: Bell,
  configuracoes: Settings,
  ia: Bot,
  equipe: UserCog,
  apis: Key,
  logs: ScrollText,
  seguranca: Shield,
};

export function PanelNavIcon({
  panel,
  routeKey,
  className,
}: {
  panel: "dashboard" | "admin";
  routeKey: string;
  className?: string;
}) {
  const map = panel === "dashboard" ? dashboardNavIcons : adminNavIcons;
  const Icon = map[routeKey] ?? LayoutDashboard;
  return (
    <Icon
      className={cn("panel-nav-icon h-[18px] w-[18px] shrink-0", className)}
      strokeWidth={1.75}
      aria-hidden
    />
  );
}
