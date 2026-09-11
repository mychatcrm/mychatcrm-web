import { NextResponse } from "next/server";
import { requireLabOwner, labError } from "@/lib/server/agent-test-lab/auth";
import { assertLabUuid } from "@/lib/agent-test-lab/policy";
import { listLabRunResources, cleanupLabRunResources } from "@/lib/server/agent-test-lab/cleanup";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
type Context = { params: { id: string } };

/** The reviewable list. Listing changes nothing. */
export async function GET(request: Request, { params }: Context) {
  try {
    await requireLabOwner(request);
    return NextResponse.json({ resources: await listLabRunResources(assertLabUuid(params.id)) },
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return labError(error); }
}

/** Cleans only the items the owner selected, and only after the run has finished. */
export async function POST(request: Request, { params }: Context) {
  try {
    await requireLabOwner(request);
    const id = assertLabUuid(params.id);
    const body = await request.json();
    const ids = Array.isArray(body.resourceIds) ? body.resourceIds.filter((value: unknown) => typeof value === "string") : [];
    if (!ids.length) throw new Error("no_resources_selected");
    const result = await cleanupLabRunResources(id, ids as string[]);
    return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return labError(error); }
}
