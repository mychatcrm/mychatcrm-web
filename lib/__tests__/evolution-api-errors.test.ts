import { describe, expect, it } from "vitest";
import { formatEvolutionHttpErrorBody } from "@/lib/integrations/evolution-api";

describe("formatEvolutionHttpErrorBody", () => {
  it("joins error and response.message array", () => {
    const s = formatEvolutionHttpErrorBody(
      {
        error: "Not Found",
        response: { message: ['The "x" instance does not exist'] },
      },
      "Bad",
    );
    expect(s).toContain("Not Found");
    expect(s).toContain("does not exist");
  });

  it("handles plain string body", () => {
    expect(formatEvolutionHttpErrorBody("EvolutionAPI: timeout", "x")).toContain("EvolutionAPI");
  });

  it("serializes nested Evolution errors instead of rendering object placeholders", () => {
    const result = formatEvolutionHttpErrorBody(
      {
        error: "Bad Request",
        response: { message: [{ instance: "locked", reason: "session_open" }] },
      },
      "Bad Request",
    );

    expect(result).toContain("session_open");
    expect(result).not.toContain("[object Object]");
  });
});
