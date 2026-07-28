/** Env config for the live example. Bun loads `.env` from cwd automatically. */

export const MODEL = process.env.MODEL ?? "deepseek/deepseek-v4-flash";

/** Exit 1 with setup instructions when the gateway key is missing. */
export function requireGatewayKey(): void {
  if (process.env.AI_GATEWAY_API_KEY) return;
  console.error(`Missing AI_GATEWAY_API_KEY.

Setup:
  1. cp .env.sample .env
  2. Paste a key from https://vercel.com/ai-gateway (or your self-hosted gateway)
  3. Optionally set MODEL (default: deepseek/deepseek-v4-flash)

Then re-run: bun run start`);
  process.exit(1);
}
