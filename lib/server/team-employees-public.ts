import type { TeamEmployee } from "@/lib/team-employees-types";

/** Resposta API: nunca envia `initialPassword` ao browser. */
export function teamEmployeeForPublicResponse(e: TeamEmployee): TeamEmployee {
  const hasInitialPassword = Boolean(e.initialPassword?.trim());
  return {
    ...e,
    initialPassword: "",
    hasInitialPassword,
  };
}
