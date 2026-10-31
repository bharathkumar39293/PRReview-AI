import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { extractDiff, isSensitiveFile } from '../src/git/diff.js';
const repos: string[] = [];
function fixture() {
  const repo = mkdtempSync(join(tmpdir(), 'prreview-test-')); repos.push(repo);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
  git('init', '--quiet'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
  git('config', 'core.autocrlf', 'false');
  writeFileSync(join(repo, 'a.txt'), 'one\ntwo\n');
  writeFileSync(join(repo, 'old.txt'), 'unchanged rename content\n');
  writeFileSync(join(repo, 'delete.txt'), 'remove\n');
  git('add', '.'); git('commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD').trim();
  return { repo, git, base };
}
afterEach(() => { for (const repo of repos.splice(0)) rmSync(repo, { recursive: true, force: true }); });
describe('Git diff extraction', () => {
  it('extracts statuses, binary metadata, statistics and hunk ranges without changing files', async () => {
    const { repo, git, base } = fixture();
    writeFileSync(join(repo, 'a.txt'), 'one\nchanged\nthree\n');
    writeFileSync(join(repo, 'added.txt'), 'new\n');
    writeFileSync(join(repo, 'binary.bin'), Buffer.from([0, 1, 2, 3]));
    renameSync(join(repo, 'old.txt'), join(repo, 'renamed.txt'));
    rmSync(join(repo, 'delete.txt'));
    git('add', '.'); git('commit', '-qm', 'head');
    const before = git('status', '--porcelain');
    const result = await extractDiff({ repo, base });
    expect(result.files.map(f => f.status)).toEqual(expect.arrayContaining(['added', 'modified', 'deleted', 'renamed']));
    expect(result.files.find(f => f.path === 'binary.bin')?.binary).toBe(true);
    expect(result.files.find(f => f.path === 'a.txt')).toMatchObject({ additions: 2, deletions: 1, hunks: [{ oldStart: 2, oldLines: 1, newStart: 2, newLines: 2 }] });
    expect(result.stats).toMatchObject({ files: 5, additions: 3, deletions: 2, binaryFiles: 1 });
    expect(git('status', '--porcelain')).toBe(before);
  });
  it('excludes sensitive content including a rename from a sensitive path', async () => {
    const { repo, git, base } = fixture();
    writeFileSync(join(repo, '.env'), 'SENTINEL_PRIVATE_CONTENT=example\n');
    git('add', '.'); git('commit', '-qm', 'sensitive');
    const result = await extractDiff({ repo, base });
    expect(result.files[0]).toMatchObject({ path: '.env', sensitive: true });
    expect(result.files[0].patch).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('SENTINEL_PRIVATE_CONTENT');
    const sensitiveBase = git('rev-parse', 'HEAD').trim();
    renameSync(join(repo, '.env'), join(repo, 'ordinary.txt'));
    git('add', '.'); git('commit', '-qm', 'rename sensitive');
    expect((await extractDiff({ repo, base: sensitiveBase })).files[0]).toMatchObject({ sensitive: true, oldPath: '.env' });
  });
  it('handles empty diffs', async () => {
    const { repo, base } = fixture();
    expect(await extractDiff({ repo, base })).toMatchObject({ empty: true, files: [], stats: { patchBytes: 0 } });
  });
  it('isolates patches when a sensitive rename reuses another rename source path', async () => {
    const { repo, git } = fixture();
    writeFileSync(join(repo, '.env'), 'private-placeholder-line\n'.repeat(100));
    writeFileSync(join(repo, 'old.txt'), 'public-placeholder-line\n'.repeat(100));
    git('add', '.'); git('commit', '-qm', 'sensitive base');
    const base = git('rev-parse', 'HEAD').trim();
    renameSync(join(repo, 'old.txt'), join(repo, 'public.txt'));
    renameSync(join(repo, '.env'), join(repo, 'old.txt'));
    writeFileSync(join(repo, 'old.txt'), 'private-placeholder-line\n'.repeat(100) + 'PRIVATE_RENAME_SENTINEL\n');
    git('add', '.'); git('commit', '-qm', 'reuse paths');
    const result = await extractDiff({ repo, base });
    expect(result.files.find(f => f.path === 'old.txt')).toMatchObject({ sensitive: true, oldPath: '.env' });
    expect(result.files.find(f => f.path === 'public.txt')).toMatchObject({ status: 'renamed', sensitive: false });
    expect(JSON.stringify(result)).not.toContain('PRIVATE_RENAME_SENTINEL');
  });
  it('rejects invalid references and option-like references', async () => {
    const { repo } = fixture();
    for (const base of ['missing-ref', '--help']) await expect(extractDiff({ repo, base })).rejects.toMatchObject({ code: 'INVALID_REFERENCE' });
  });
  it('rejects non-repositories', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'prreview-test-')); repos.push(repo);
    await expect(extractDiff({ repo, base: 'HEAD' })).rejects.toMatchObject({ code: 'GIT_ERROR' });
  });
  it('rejects individual and aggregate oversized patches', async () => {
    const { repo, git, base } = fixture();
    writeFileSync(join(repo, 'a.txt'), 'x'.repeat(4000));
    git('add', '.'); git('commit', '-qm', 'large');
    await expect(extractDiff({ repo, base, maxDiffBytes: 1000 })).rejects.toMatchObject({ code: 'DIFF_TOO_LARGE' });
    writeFileSync(join(repo, 'b.txt'), 'y'.repeat(4000));
    git('add', '.'); git('commit', '-qm', 'aggregate');
    await expect(extractDiff({ repo, base, maxDiffBytes: 6000 })).rejects.toMatchObject({ code: 'DIFF_TOO_LARGE' });
  });
  it('handles unusual filenames as literal pathspecs', async () => {
    const { repo, git, base } = fixture();
    writeFileSync(join(repo, '[literal].txt'), 'literal\n');
    git('add', '.'); git('commit', '-qm', 'literal');
    expect((await extractDiff({ repo, base })).files[0]).toMatchObject({ path: '[literal].txt', additions: 1 });
  });
  it('does not invoke repository diff helpers and counts content resembling headers', async () => {
    const { repo, git, base } = fixture();
    git('config', 'diff.external', 'this-command-must-never-execute');
    git('config', 'diff.untrusted.textconv', 'this-command-must-never-execute');
    writeFileSync(join(repo, '.gitattributes'), '*.txt diff=untrusted\n');
    writeFileSync(join(repo, 'a.txt'), '+++literal\n---literal\n');
    git('add', '.'); git('commit', '-qm', 'untrusted helpers');
    expect((await extractDiff({ repo, base })).files.find(f => f.path === 'a.txt')).toMatchObject({ additions: 2, deletions: 2 });
  });
  it('runs the CLI with defaults and JSON output', () => {
    const { repo, base } = fixture();
    const cli = resolve('src/cli.ts');
    const run = (...args: string[]) => execFileSync(process.execPath, ['--import', pathToFileURL(resolve('node_modules/tsx/dist/loader.mjs')).href, cli, 'review', ...args], { cwd: repo, encoding: 'utf8' });
    expect(JSON.parse(run('--base', base, '--format', 'json'))).toMatchObject({ empty: true, aiAnalysis: false });
    expect(run('--base', base)).toContain('No changes');
  }, 20_000);
  it('requires upload approval for a nonempty CLI diff and skips approved empty diffs', () => {
    const { repo, base, git } = fixture();
    writeFileSync(join(repo, 'a.txt'), 'CLI_PRIVATE_PATCH_SENTINEL\n');
    git('add', '.'); git('commit', '-qm', 'CLI changed');
    const cli = resolve('src/cli.ts');
    const run = (...args: string[]) => execFileSync(process.execPath, ['--import', pathToFileURL(resolve('node_modules/tsx/dist/loader.mjs')).href, cli, 'review', ...args], {
      cwd: repo, encoding: 'utf8', env: { ...process.env, GEMINI_API_KEY: '', GEMINI_MODEL: '' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const report = JSON.parse(run('--base', base, '--format', 'json'));
    expect(report).toMatchObject({ aiAnalysis: false, status: 'upload-not-approved' });
    expect(report.notice).toContain('--allow-upload');
    expect(JSON.stringify(report)).not.toContain('CLI_PRIVATE_PATCH_SENTINEL');
    expect(JSON.parse(run('--base', 'HEAD', '--allow-upload', '--format', 'json'))).toMatchObject({ aiAnalysis: false, status: 'empty', model: null });
  }, 20_000);
});
it.each(['.env', '.env.local', 'config/.env.production', 'private.pem', 'tls.key', '.aws/config', 'id_ed25519', 'credentials.json', 'service-account.json'])('detects sensitive file %s', path => expect(isSensitiveFile(path)).toBe(true));
it('allows ordinary source files', () => expect(isSensitiveFile('src/index.ts')).toBe(false));
