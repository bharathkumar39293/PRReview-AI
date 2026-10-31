import type { DiffResult } from '../git/diff.js';
import type { AnalysisResult } from '../ai/analyzer.js';
import { severities, type Finding } from '../review/schema.js';

export const DISCLAIMER = 'Findings are AI-generated hypotheses, not confirmed bugs.';
export const TESTS_STATEMENT = 'Tests were not executed by this review.';
export interface ReportContext {
  repository?: string;
  baseRef?: string;
  headRef?: string;
  analysis?: AnalysisResult;
  notice?: string;
}

export function buildReport(diff: DiffResult, context: ReportContext = {}) {
  const analysis = context.analysis;
  const findings = Object.fromEntries(severities.map(severity =>
    [severity, (analysis?.review?.findings ?? []).filter(f => f.severity === severity)])) as Record<typeof severities[number], Finding[]>;
  return {
    phase: analysis ? 2 : 1,
    aiAnalysis: analysis?.status === 'reviewed',
    repository: context.repository ?? null,
    base: diff.base, head: diff.head,
    references: { base: context.baseRef ?? diff.base, head: context.headRef ?? diff.head },
    empty: diff.empty, stats: diff.stats,
    // Full source patches never belong in a report, even for local-only invocations.
    files: diff.files.map(({ patch: _patch, ...metadata }) => metadata),
    model: analysis?.model ?? null,
    status: analysis?.status ?? 'upload-not-approved',
    summary: analysis?.review?.summary ?? (diff.empty ? 'No changes between the selected commits.' :
      analysis?.status === 'no-eligible-files' ? 'No eligible text files to review.' : 'No AI review performed.'),
    findings, rejectedFindings: analysis?.rejectedFindings ?? 0,
    disclaimer: DISCLAIMER, testsExecuted: false, testsStatement: TESTS_STATEMENT,
    notice: context.notice ?? null,
  };
}
