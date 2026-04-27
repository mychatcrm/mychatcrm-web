import { redirect } from "next/navigation";
import { getClientSessionFromCookies } from "@/lib/client-auth-server";

/** Fluxo de criação passou para overlay na lista de agentes; mantemos a rota para links antigos. */
export default async function DashboardCriarAgentePage() {
  const session = await getClientSessionFromCookies();
  if (!session) redirect("/login?from=/dashboard/agentes/criar");
  redirect("/dashboard/agentes?criar=1");
}
