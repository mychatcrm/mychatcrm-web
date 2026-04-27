import { redirect } from "next/navigation";
import { DashboardAppEntry } from "../_components/DashboardAppEntry";
import { dashboardSegmentToRouteKey } from "@/lib/routing/dashboard-segments";

export default async function DashboardSlugPage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const { slug } = await params;

  if (!slug?.length) {
    redirect("/dashboard");
  }

  if (slug.length > 1) {
    redirect(`/dashboard/${slug[0]}`);
  }

  const firstSegment = slug[0]?.trim().toLowerCase() ?? "";
  if (firstSegment === "funil") {
    redirect("/dashboard/crm");
  }

  if (firstSegment === "chatbot") {
    redirect("/dashboard/agentes");
  }

  const routeKey = dashboardSegmentToRouteKey(slug[0] ?? "");
  if (!routeKey) {
    redirect("/dashboard");
  }

  return <DashboardAppEntry routeKey={routeKey} />;
}
