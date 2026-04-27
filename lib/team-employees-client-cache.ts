"use client";

import type { TeamEmployee } from "@/lib/team-employees-types";

const cache = new Map<string, TeamEmployee[]>();

export function getTeamEmployeesCache(tenantId: string): TeamEmployee[] | undefined {
  return cache.get(tenantId);
}

export function setTeamEmployeesCache(tenantId: string, list: TeamEmployee[]) {
  cache.set(tenantId, list);
}

export async function refreshTeamEmployeesFromApi(tenantId: string): Promise<TeamEmployee[]> {
  const res = await fetch("/api/team-employees", { credentials: "include", cache: "no-store" });
  if (!res.ok) {
    cache.delete(tenantId);
    return [];
  }
  const data = (await res.json()) as { employees?: TeamEmployee[] };
  const list = Array.isArray(data.employees) ? data.employees : [];
  cache.set(tenantId, list);
  return list;
}
