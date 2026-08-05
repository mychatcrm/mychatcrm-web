import type { ExternalApiOperationInput } from "@/lib/external-api/types";

export function createStandardExternalApiOperations(): ExternalApiOperationInput[] {
  return [
    { operationKey: "listar", name: "Listar", description: "Lista informações disponíveis na API", method: "GET", pathTemplate: "/", parameters: [], responseMapping: {}, cacheTtlSeconds: 0, enabled: true },
    { operationKey: "buscar", name: "Buscar", description: "Busca informações na API por um texto", method: "GET", pathTemplate: "/search", parameters: [{ name: "query", in: "query", type: "string", required: true, description: "Texto que deve ser pesquisado" }], responseMapping: {}, cacheTtlSeconds: 0, enabled: true },
    { operationKey: "detalhar", name: "Detalhar", description: "Obtém os detalhes de um registro pelo identificador", method: "GET", pathTemplate: "/{id}", parameters: [{ name: "id", in: "path", type: "string", required: true, description: "Identificador do registro" }], responseMapping: {}, cacheTtlSeconds: 0, enabled: true },
  ];
}
