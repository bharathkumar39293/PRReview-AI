#!/usr/bin/env node
import { Command, InvalidArgumentError } from 'commander';
import { loadConfig } from './config.js';
import { extractDiff } from './git/diff.js';
import { renderJson } from './reports/json.js';
import { renderMarkdown } from './reports/markdown.js';
import { logger } from './utils/logger.js';
import { analyze } from './ai/analyzer.js';
import { UPLOAD_NOTICE, SECRET_WARNING } from './ai/prompt.js';
import { resolve } from 'node:path';
import type { ReportContext } from './reports/report.js';
const program = new Command().name('prreview-ai').description('PRReview AI: Gemini-powered Git diff review').version('0.1.0');
program.command('review').option('--repo <path>', 'Git repository', process.cwd()).requiredOption('--base <ref>', 'Base Git reference').option('--head <ref>', 'Head Git reference', 'HEAD').option('--allow-upload', 'Approve eligible diff transmission to Google Gemini for this invocation').option('--format <format>', 'markdown or json', value => {
  if (!['markdown', 'json'].includes(value)) throw new InvalidArgumentError('Expected markdown or json.');
  return value;
}, 'markdown').action(async options => {
  const config = loadConfig();
  const diff = await extractDiff({ repo: options.repo, base: options.base, head: options.head, maxDiffBytes: config.MAX_DIFF_BYTES });
  const context: ReportContext = { repository: resolve(options.repo), baseRef: options.base, headRef: options.head };
  if (options.allowUpload) {
    process.stderr.write(`${SECRET_WARNING}\n`);
    context.analysis = await analyze({ diff, allowUpload: true, config, maxInputBytes: config.MAX_AI_INPUT_BYTES });
  } else {
    context.notice = `${UPLOAD_NOTICE} ${SECRET_WARNING}`;
  }
  process.stdout.write((options.format === 'json' ? renderJson(diff, context) : renderMarkdown(diff, context)) + '\n');
});
program.parseAsync().catch(error => { logger.error(error instanceof Error ? error.message : 'Review failed.'); process.exitCode = 1; });
