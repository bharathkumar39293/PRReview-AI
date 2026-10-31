import { posix, win32 } from 'node:path';
import { isSensitiveFile, type DiffFile, type DiffResult } from '../git/diff.js';
import type { Review } from './schema.js';

export function isSafeReviewPath(path: string): boolean {
  return !!path && !posix.isAbsolute(path) && !win32.isAbsolute(path) &&
    !/^[a-z]:/i.test(path) && !path.includes('\0') && !path.split(/[\\/]/).includes('..');
}

export function eligibleFiles(diff: DiffResult): DiffFile[] {
  return diff.files.filter(file => !file.sensitive && !file.binary &&
    isSafeReviewPath(file.path) && !isSensitiveFile(file.path) &&
    (!file.oldPath || (isSafeReviewPath(file.oldPath) && !isSensitiveFile(file.oldPath))) &&
    typeof file.patch === 'string' && file.patch.length > 0);
}

export function validateFindings(review: Review, diff: DiffResult): { review: Review; rejectedFindings: number } {
  const files = new Map(eligibleFiles(diff).map(file => [file.path, file]));
  const findings = review.findings.filter(finding => {
    if (!isSafeReviewPath(finding.path) || !Number.isSafeInteger(finding.line) || finding.line < 1) return false;
    const file = files.get(finding.path);
    return file !== undefined && file.status !== 'deleted' && file.hunks.some(hunk =>
      hunk.newLines > 0 && finding.line >= hunk.newStart && finding.line < hunk.newStart + hunk.newLines);
  });
  return { review: { summary: review.summary, findings }, rejectedFindings: review.findings.length - findings.length };
}
