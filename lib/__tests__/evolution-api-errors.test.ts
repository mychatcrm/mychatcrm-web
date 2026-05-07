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
});
