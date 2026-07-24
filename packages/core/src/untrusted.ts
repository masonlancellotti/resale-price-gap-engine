import { z } from "zod";

/**
 * Untrusted-input discipline (plan §2.3 P5, §12.5). All adapter payloads, listing text, and
 * counterparty messages are adversarial. They enter the system only through a schema gate: parse,
 * don't trust. A payload that fails its schema becomes an `unidentified`/quarantine event — it never
 * flows onward as if valid, and its free text never becomes an instruction to another agent.
 */
export class UntrustedInputError extends Error {
  constructor(
    readonly context: string,
    readonly issues: z.ZodIssue[],
  ) {
    super(`untrusted input failed validation at ${context}: ${issues.map((i) => i.message).join("; ")}`);
    this.name = "UntrustedInputError";
  }
}

export function parseUntrusted<T>(schema: z.ZodType<T>, payload: unknown, context: string): T {
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new UntrustedInputError(context, result.error.issues);
  }
  return result.data;
}

export { z };
