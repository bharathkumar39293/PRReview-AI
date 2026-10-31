import dotenv from 'dotenv';
import { z } from 'zod';

const configSchema = z.object({
  GEMINI_API_KEY: z.string().default(''),
  GEMINI_MODEL: z.string().default(''),
  MAX_DIFF_BYTES: z.coerce.number().int().positive().max(100_000_000).default(1_048_576),
  MAX_AI_INPUT_BYTES: z.coerce.number().int().positive().max(100_000_000).default(131_072),
});

export function loadConfig() {
  // Read configuration from the CLI working directory, never from --repo.
  dotenv.config({ quiet: true });
  const parsed = configSchema.safeParse(process.env);
  if (!parsed.success) throw new Error('Invalid configuration: MAX_DIFF_BYTES and MAX_AI_INPUT_BYTES must be positive integers at most 100000000.');
  return parsed.data;
}
