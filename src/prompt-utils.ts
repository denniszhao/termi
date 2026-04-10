import { cancel, isCancel } from "@clack/prompts";

export function handleCancel<T>(value: T): asserts value is Exclude<T, symbol> {
  if (isCancel(value)) {
    cancel("Cancelled.");
    process.exit(0);
  }
}
