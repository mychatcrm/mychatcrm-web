import { AsyncLocalStorage } from "node:async_hooks";
import type { AiGenerateInput, AiGenerateResult } from "./types";

/** Server-established scope. No HTTP parameter or model output can enable it. */
export type AiExecutionBudget = {
  deadline: number;
  invoke: (input: AiGenerateInput, execute: (input: AiGenerateInput) => Promise<AiGenerateResult>) => Promise<AiGenerateResult>;
};
const scopes = new AsyncLocalStorage<AiExecutionBudget>();
export function withAiExecutionBudget<T>(budget: AiExecutionBudget, task: () => Promise<T>): Promise<T> {
  if (scopes.getStore()) throw new Error("ai_budget_scope_nested");
  return scopes.run(budget, task);
}
export function aiExecutionDeadline(): number | undefined { return scopes.getStore()?.deadline; }
export function invokeWithAiExecutionBudget(
  input: AiGenerateInput, execute: (input: AiGenerateInput) => Promise<AiGenerateResult>,
): Promise<AiGenerateResult> {
  const scope = scopes.getStore();
  return scope ? scope.invoke(input, execute) : execute(input);
}
