import { Command } from "commander";
import pkg from "../../package.json" with { type: "json" };
import { registerAddCommand } from "./add.js";
import { registerLaundryCommands } from "./laundry.js";
import { registerListCommand } from "./list.js";
import { registerOutfitCommand } from "./outfit.js";
import { registerWoreRateCommands } from "./wore.js";

/**
 * Thin CLI shell over `src/core` (ADR-0002). This entrypoint only wires up
 * argument parsing and help text — no product logic lives here. Each command
 * registers itself from its own module.
 *
 * Launched via `bin/closet` (tsx), so no `#!/usr/bin/env node` shebang: the
 * file is never run directly by node.
 */
const program = new Command();

program
  .name("closet")
  .description("ClosetOS — a daily-use wardrobe assistant")
  .version(pkg.version);

registerAddCommand(program);
registerLaundryCommands(program);
registerListCommand(program);
registerOutfitCommand(program);
registerWoreRateCommands(program);

await program.parseAsync(process.argv);
