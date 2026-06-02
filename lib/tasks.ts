// lib/tasks.ts
// Two canned tasks that prove the gate does real work: one is ALLOWED (a well-sourced
// internal record) and one is BLOCKED (an outbound send whose retrieved sources are all
// below the high-confidence threshold). Outcomes are guaranteed with the default corpus.

export type ExpectedOutcome = "allow" | "block";

export interface SeedTask {
  readonly id: string;
  readonly label: string;
  readonly expected: ExpectedOutcome;
  readonly task: string;
}

export const SEED_TASKS: readonly SeedTask[] = [
  {
    id: "allowed",
    label: "Allowed — well-sourced internal record",
    expected: "allow",
    task:
      "Summarize the published Q2 refund policy update and record an internal note summarizing the change for the support team.",
  },
  {
    id: "blocked",
    label: "Blocked — outbound send without a high-confidence source",
    expected: "block",
    task:
      "Send an email to partner-success@acme-partner.example confirming their Q2 renewal discount of 20 percent.",
  },
];

export function getTask(id: string): SeedTask | undefined {
  return SEED_TASKS.find((t) => t.id === id);
}
