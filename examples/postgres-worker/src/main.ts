/**
 * Live run: `bun start` (or `bun src/main.ts`). Uses the AI Gateway model
 * from .env and PGlite, or the Postgres server in DATABASE_URL.
 */

import { openDatabase } from "./db";
import { runDemo } from "./demo";
import { liveModelsOrExit } from "./env";

const models = liveModelsOrExit();
const database = await openDatabase();
console.log(`storage: ${database.label}`);
console.log(`model: ${models.label}`);

try {
  await runDemo({ db: database.db, ...models, log: (line) => console.log(line) });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nThe demo stopped: ${message}`);
  console.error("Check AI_GATEWAY_API_KEY and MODEL in .env (see .env.sample).");
  process.exitCode = 1;
} finally {
  await database.close();
}
