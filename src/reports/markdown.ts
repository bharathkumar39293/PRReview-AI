import type { DiffResult } from '../git/diff.js';
import { buildReport, type ReportContext } from './report.js';
import { severities } from '../review/schema.js';
const safe = (value: string) => value.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/([\\`*_[\]#|])/g, '\\$1');
export function renderMarkdown(diff: DiffResult, context?: ReportContext): string {
  const report = buildReport(diff, context);
  const lines = ['# PRReview AI', '', `Repository: ${safe(report.repository ?? '(unspecified)')}`,
    `Base: ${safe(report.references.base)} (${safe(report.base)})`, `Head: ${safe(report.references.head)} (${safe(report.head)})`,
    `AI model used: ${safe(report.model ?? 'none')}`, '', report.disclaimer, report.testsStatement, '',
    ...(report.notice ? [safe(report.notice), ''] : []),
    `${diff.stats.files} files; +${diff.stats.additions} / -${diff.stats.deletions}; ${diff.stats.binaryFiles} binary files; ${diff.stats.sensitiveFiles} sensitive files excluded.`, '',
    '## Summary', '', safe(report.summary), '', `Rejected findings: ${report.rejectedFindings}`, '',
    '## Changed files', '', ...diff.files.map(f => `- ${safe(f.path)} (${f.status}${f.binary ? ', binary' : ''}${f.sensitive ? ', sensitive: content excluded' : `, +${f.additions} / -${f.deletions}`})`)];
  for (const severity of severities) {
    lines.push('', `## ${severity} (${report.findings[severity].length})`, '');
    for (const finding of report.findings[severity]) {
      lines.push(`### ${safe(finding.title)}`, '', `${safe(finding.path)}:${finding.line} — ${finding.category}; confidence: ${finding.confidence}`, '',
        safe(finding.description), '', `Suggested fix: ${safe(finding.suggestion)}`, '');
    }
  }
  return lines.join('\n');
}
