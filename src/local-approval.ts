import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export interface LocalApprovalPrompt {
  code: string;
  intent: "replace-active-session" | "trust";
  label: string;
}

export async function promptForLocalApproval(prompt: LocalApprovalPrompt): Promise<boolean> {
  const rl = createInterface({ input, output });

  try {
    const answer = await rl.question(
      prompt.intent === "replace-active-session"
        ? `  Approve ${prompt.label} with code ${prompt.code} and replace the current remote session? [y/N] `
        : `  Approve ${prompt.label} with code ${prompt.code}? [y/N] `,
    );
    return /^(y|yes)$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}
