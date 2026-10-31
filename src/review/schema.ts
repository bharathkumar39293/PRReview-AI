import { z } from 'zod';
export const severities = ['critical', 'high', 'medium', 'low'] as const;
export const findingSchema = z.object({
  path: z.string().min(1),
  line: z.number().int().positive(),
  severity: z.enum(severities),
  category: z.enum(['bug', 'security', 'performance', 'error-handling', 'missing-test']),
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  suggestion: z.string().trim().min(1),
  confidence: z.enum(['high', 'medium', 'low']),
});
export const reviewSchema = z.object({
  summary: z.string(),
  findings: z.array(findingSchema),
});
export type Review = z.infer<typeof reviewSchema>;
export type Finding = z.infer<typeof findingSchema>;
// Keep the strict Zod contract locally. The provider only needs the structure:
// Zod's default conversion adds draft metadata, exclusiveMinimum/minLength, and
// an implicit MAX_SAFE_INTEGER bound that can complicate constrained decoding.
// Project the common subset instead of weakening local response validation.
interface ProviderSchema {
  type?: string;
  properties?: Record<string, ProviderSchema>;
  items?: ProviderSchema;
  required?: string[];
  enum?: (string | number | boolean | null)[];
}
function providerSchema(schema: Record<string, unknown>): ProviderSchema {
  const result: ProviderSchema = {};
  if (typeof schema.type === 'string') result.type = schema.type;
  if (schema.properties && typeof schema.properties === 'object') {
    result.properties = Object.fromEntries(Object.entries(schema.properties).map(([key, value]) =>
      [key, providerSchema(value as Record<string, unknown>)]));
  }
  if (schema.items) result.items = providerSchema(schema.items as Record<string, unknown>);
  if (Array.isArray(schema.required)) result.required = schema.required as string[];
  if (Array.isArray(schema.enum)) result.enum = schema.enum;
  return result;
}
export const reviewJsonSchema = providerSchema(z.toJSONSchema(reviewSchema));
