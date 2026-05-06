import { vi } from "vitest";

/** Permite importar módulos que usam `server-only` nos testes Vitest (ambiente Node). */
vi.mock("server-only", () => ({}));
