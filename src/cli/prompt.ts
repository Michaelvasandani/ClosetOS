/**
 * Shared readline prompter for the interactive CLI shells (`add`, `dirty`/`clean`
 * disambiguation). Kept apart from any single command so the line-reading logic —
 * which has to apply backpressure so piped input is never dropped — lives in one
 * place. No domain logic here: this is pure IO.
 */

import { createInterface } from "node:readline";

/** A minimal line-reader: prints a prompt, resolves with the next line typed. */
export interface Prompter {
  question(query: string): Promise<string>;
  /** True once the input stream is exhausted (EOF) — no more answers will come. */
  readonly done: boolean;
}

/**
 * Build a Prompter over stdin using readline's async line iterator, which applies
 * backpressure so no line is dropped when input is piped in all at once (unlike
 * `readline/promises` `question`, which loses lines that arrive before it's called).
 */
export function createPrompter(): { prompter: Prompter; close: () => void } {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const lines = rl[Symbol.asyncIterator]();
  let done = false;
  const prompter: Prompter = {
    get done() {
      return done;
    },
    async question(query: string): Promise<string> {
      process.stdout.write(query);
      const next = await lines.next();
      if (next.done) {
        done = true;
        return "";
      }
      return next.value;
    },
  };
  return { prompter, close: () => rl.close() };
}
