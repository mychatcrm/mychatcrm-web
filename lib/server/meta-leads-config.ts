import "server-only";

export type MetaLeadsTokenMode =
  | "business_integration_system_user"
  | "user";

export function resolveMetaLeadsTokenMode(): MetaLeadsTokenMode | null {
  const configured = process.env.META_LEADS_TOKEN_MODE?.trim().toLowerCase();
  if (configured === "business_integration_system_user" || configured === "user") {
    return configured;
  }
  return null;
}

export function metaLeadsBusinessLoginConfiguration(): {
  configurationId: string | null;
  tokenMode: MetaLeadsTokenMode | null;
} {
  return {
    configurationId: process.env.META_LEADS_CONFIG_ID?.trim() || null,
    tokenMode: resolveMetaLeadsTokenMode(),
  };
}
