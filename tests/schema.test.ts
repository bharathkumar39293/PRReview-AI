import { expect, it } from 'vitest';
import { reviewSchema, reviewJsonSchema } from '../src/review/schema.js';
it('validates the review contract', () => {
  expect(reviewSchema.safeParse({ summary: 'OK', findings: [] }).success).toBe(true);
  expect(reviewSchema.safeParse({ summary: 'Issue', findings: [{ path: 'a', line: 0, severity: 'bad', message: 'Issue' }] }).success).toBe(false);
});
it('uses a minimal provider schema without weakening local constraints', () => {
  const allowed = new Set(['type', 'properties', 'items', 'required', 'enum']);
  const check = (schema: typeof reviewJsonSchema) => {
    expect(Object.keys(schema).every(key => allowed.has(key))).toBe(true);
    for (const child of Object.values(schema.properties ?? {})) check(child);
    if (schema.items) check(schema.items);
  };
  check(reviewJsonSchema);
  expect(reviewJsonSchema.properties?.findings.items?.properties?.line).toEqual({ type: 'integer' });
  const valid = { path: 'app.ts', line: 1, severity: 'high', category: 'bug', title: 'Title', description: 'Description', suggestion: 'Suggestion', confidence: 'high' };
  expect(reviewSchema.safeParse({ summary: 'Review', findings: [valid] }).success).toBe(true);
  for (const invalid of [{ line: 0 }, { line: 1.5 }, { line: Number.MAX_SAFE_INTEGER + 1 }, { title: ' ' }, { description: '' }, { suggestion: '' }]) {
    expect(reviewSchema.safeParse({ summary: 'Review', findings: [{ ...valid, ...invalid }] }).success).toBe(false);
  }
});
