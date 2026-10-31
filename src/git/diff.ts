import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { ReviewError } from '../utils/errors.js';

export interface DiffFile {
  path: string;
  oldPath?: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'typechanged' | 'unknown';
  binary: boolean;
  sensitive: boolean;
  additions: number;
  deletions: number;
  hunks: { oldStart: number; oldLines: number; newStart: number; newLines: number }[];
  patch?: string;
}
export interface DiffResult {
  base: string;
  head: string;
  files: DiffFile[];
  stats: { files: number; additions: number; deletions: number; binaryFiles: number; sensitiveFiles: number; patchBytes: number };
  empty: boolean;
}

export function isSensitiveFile(path: string): boolean {
  const parts = path.toLowerCase().split(/[\\/]/);
  const name = parts.at(-1)!;
  return parts.some(p => ['.ssh', '.aws', '.gnupg'].includes(p)) ||
    /^\.env(?:\.|$)/.test(name) || /\.(pem|key|p12|pfx|keystore)$/.test(name) ||
    /^(id_rsa|id_dsa|id_ecdsa|id_ed25519)(\.|$)/.test(name) ||
    /(credentials|secrets?|service[-_]?account)/.test(name) || name === '.npmrc' || name === '.netrc';
}

function git(repo: string, args: string[], maxBuffer = 1_048_576): Promise<string> {
  return new Promise((resolveOutput, reject) => {
    execFile('git', ['--no-pager', '--literal-pathspecs', '-c', 'core.fsmonitor=false', '-c', 'diff.external=', ...args], {
      cwd: repo, shell: false, encoding: 'utf8', maxBuffer,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' },
    }, (error, stdout) => {
      if (error) {
        const code = (error as NodeJS.ErrnoException).code;
        reject(new ReviewError(code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? 'DIFF_TOO_LARGE' : 'GIT_ERROR', code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? 'Diff exceeds the configured maximum size.' : 'Git operation failed. Check the repository and references.'));
      } else resolveOutput(stdout);
    });
  });
}

export async function extractDiff(options: { repo: string; base: string; head?: string; maxDiffBytes?: number }): Promise<DiffResult> {
  const repo = resolve(options.repo);
  const max = options.maxDiffBytes ?? 1_048_576;
  if (!Number.isSafeInteger(max) || max <= 0 || max > 100_000_000) throw new ReviewError('INVALID_LIMIT', 'Invalid maximum diff size.');
  await git(repo, ['rev-parse', '--show-toplevel']);
  const revision = async (ref: string) => {
    if (!ref || ref.startsWith('-') || ref.includes('\0')) throw new ReviewError('INVALID_REFERENCE', 'Invalid Git reference.');
    try { return (await git(repo, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`])).trim(); }
    catch { throw new ReviewError('INVALID_REFERENCE', 'Invalid Git reference.'); }
  };
  const base = await revision(options.base);
  const head = await revision(options.head ?? 'HEAD');
  const common = ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--find-renames', '--ignore-submodules=all'];
  const names = (await git(repo, [...common, '--break-rewrites', '--name-status', '-z', base, head, '--'], max)).split('\0');
  const files: DiffFile[] = [];
  let patchBytes = 0;
  for (let i = 0; i < names.length && names[i];) {
    const statusCode = names[i++][0];
    const first = names[i++];
    const renamed = statusCode === 'R' || statusCode === 'C';
    const path = renamed ? names[i++] : first;
    const status = ({ A: 'added', M: 'modified', D: 'deleted', R: 'renamed', C: 'copied', T: 'typechanged' } as const)[statusCode as 'A'] ?? 'unknown';
    const file: DiffFile = { path, ...(renamed ? { oldPath: first } : {}), status, binary: false, sensitive: isSensitiveFile(path) || (renamed && isSensitiveFile(first)), additions: 0, deletions: 0, hunks: [] };
    if (!file.sensitive) {
      // Tree path filters can include another rename that reuses this file's old
      // path. Compare the exact blob pair for renames; disable rename matching
      // for other individual paths so excluded files cannot leak into a patch.
      let patch: string;
      if (renamed) {
        const oldBlob = (await git(repo, ['rev-parse', '--verify', '--end-of-options', `${base}:${first}`])).trim();
        const newBlob = (await git(repo, ['rev-parse', '--verify', '--end-of-options', `${head}:${path}`])).trim();
        patch = await git(repo, [...common, '--no-renames', '--unified=0', oldBlob, newBlob, '--'], max);
      } else {
        patch = await git(repo, [...common, '--no-renames', '--unified=0', base, head, '--', path], max);
      }
      patchBytes += Buffer.byteLength(patch);
      if (patchBytes > max) throw new ReviewError('DIFF_TOO_LARGE', 'Diff exceeds the configured maximum size.');
      file.binary = /^Binary files .* differ$/m.test(patch) || patch.includes('GIT binary patch');
      let inHunk = false;
      for (const line of patch.split('\n')) {
        if (inHunk && line.startsWith('+')) file.additions++;
        if (inHunk && line.startsWith('-')) file.deletions++;
        const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
        if (hunk) inHunk = true;
        if (hunk) file.hunks.push({ oldStart: +hunk[1], oldLines: +(hunk[2] ?? 1), newStart: +hunk[3], newLines: +(hunk[4] ?? 1) });
      }
      file.patch = patch;
    }
    files.push(file);
  }
  return { base, head, files, empty: files.length === 0, stats: { files: files.length, additions: files.reduce((n, f) => n + f.additions, 0), deletions: files.reduce((n, f) => n + f.deletions, 0), binaryFiles: files.filter(f => f.binary).length, sensitiveFiles: files.filter(f => f.sensitive).length, patchBytes } };
}
