import type { DiffResult } from '../git/diff.js';
import { buildReport, type ReportContext } from './report.js';
export function renderJson(diff: DiffResult, context?: ReportContext): string { return JSON.stringify(buildReport(diff, context), null, 2); }
