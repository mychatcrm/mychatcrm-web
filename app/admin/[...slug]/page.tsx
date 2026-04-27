import { redirect } from "next/navigation";
import { AdminAppEntry } from "../_components/AdminAppEntry";
import { adminSegmentToRouteKey } from "@/lib/routing/admin-segments";

export default async function AdminSlugPage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const { slug } = await params;

  if (!slug?.length) {
    redirect("/admin");
  }

  if (slug.length > 1) {
    redirect(`/admin/${slug[0]}`);
  }

  const routeKey = adminSegmentToRouteKey(slug[0] ?? "");
  if (!routeKey) {
    redirect("/admin");
  }

  if (routeKey === "dashboard") {
    redirect("/admin");
  }

  return <AdminAppEntry routeKey={routeKey} />;
}
