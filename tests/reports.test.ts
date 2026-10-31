import { expect, it } from 'vitest';
import { renderJson } from '../src/reports/json.js';
import { renderMarkdown } from '../src/reports/markdown.js';
import type { DiffResult } from '../src/git/diff.js';
import type { AnalysisResult } from '../src/ai/analyzer.js';
const diff: DiffResult = { base: 'a', head: 'b', files: [], empty: true, stats: { files: 0, additions: 0, deletions: 0, binaryFiles: 0, sensitiveFiles: 0, patchBytes: 0 } };
it('renders valid JSON and empty-diff markdown', () => {
  expect(JSON.parse(renderJson(diff))).toMatchObject({ phase: 1, aiAnalysis: false, empty: true });
  expect(renderMarkdown(diff)).toContain('No changes');
});
it('escapes untrusted filenames and marks sensitive files', () => {
  const result = renderMarkdown({ ...diff, empty: false, files: [{ path: '<script>[x].env', status: 'added', binary: false, sensitive: true, additions: 0, deletions: 0, hunks: [] }] });
  expect(result).not.toContain('<script>');
  expect(result).toContain('content excluded');
});
it('includes grouped validated findings, references, suggestions and disclaimers without patches', () => {
  const analysis: AnalysisResult = { status: 'reviewed', model: 'configured-test-model', rejectedFindings: 3,
    review: { summary: 'Potential issue.', findings: [{ path: 'src/app.ts', line: 12, severity: 'high', category: 'bug',
      title: 'Guard result', description: 'A result may be absent.', suggestion: 'Add a guard.', confidence: 'medium' }] } };
  const input: DiffResult = { ...diff, empty: false, files: [{ path: 'src/app.ts', status: 'modified', sensitive: false, binary: false, additions: 1, deletions: 0, hunks: [], patch: 'FULL_PATCH_SENTINEL' }] };
  const context = { repository: '/repo', baseRef: 'main', headRef: 'HEAD', analysis };
  const json = JSON.parse(renderJson(input, context));
  expect(json).toMatchObject({ repository: '/repo', references: { base: 'main', head: 'HEAD' }, model: analysis.model,
    rejectedFindings: 3, findings: { critical: [], high: analysis.review!.findings }, testsExecuted: false });
  const markdown = renderMarkdown(input, context);
  for (const output of [JSON.stringify(json), markdown]) {
    expect(output).toContain('AI-generated hypotheses, not confirmed bugs');
    expect(output).toContain('Tests were not executed by this review.');
    expect(output).toContain('Add a guard.');
    expect(output).not.toContain('FULL_PATCH_SENTINEL');
  }
  expect(markdown).toContain('src/app.ts:12');
  expect(markdown).toContain('Rejected findings: 3');
});
