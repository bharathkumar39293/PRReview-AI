import { beforeEach, expect, it, vi } from 'vitest';
import { analyze } from '../src/ai/analyzer.js';
import { createAIClient } from '../src/ai/client.js';
import { REVIEW_SYSTEM_INSTRUCTION } from '../src/ai/prompt.js';
import type { DiffFile, DiffResult } from '../src/git/diff.js';
import type { Finding } from '../src/review/schema.js';

const { generateContent, initialize } = vi.hoisted(() => ({ generateContent: vi.fn(), initialize: vi.fn() }));
vi.mock('@google/genai', () => ({ GoogleGenAI: class {
  models = { generateContent };
  constructor(options: unknown) { initialize(options); }
} }));
const config = { GEMINI_API_KEY: 'test-placeholder-not-a-real-key', GEMINI_MODEL: 'configured-test-model' };
const finding: Finding = { path: 'src/app.ts', line: 10, severity: 'high', category: 'bug', title: 'Check the result',
  description: 'The changed branch may dereference an absent result.', suggestion: 'Guard the result before using it.', confidence: 'medium' };
const file: DiffFile = { path: 'src/app.ts', status: 'modified', sensitive: false, binary: false, additions: 2, deletions: 1,
  hunks: [{ oldStart: 10, oldLines: 1, newStart: 10, newLines: 2 }], patch: '@@ -10 +10,2 @@\n-before\n+after\n+next\n' };
function diff(files: DiffFile[] = [structuredClone(file)]): DiffResult {
  return { base: 'base-commit', head: 'head-commit', files, empty: files.length === 0,
    stats: { files: files.length, additions: 2, deletions: 1, sensitiveFiles: 0, binaryFiles: 0, patchBytes: 100 } };
}
const options = () => ({ diff: diff(), allowUpload: true, config });
const response = (findings: Finding[] = [finding]) => ({ text: JSON.stringify({ summary: 'Potential issue in changed code.', findings }) });
beforeEach(() => { initialize.mockReset(); generateContent.mockReset(); generateContent.mockResolvedValue(response()); });

it('requests structured JSON with the configured model and preserves valid findings', async () => {
  expect(await analyze(options())).toMatchObject({ status: 'reviewed', model: config.GEMINI_MODEL, rejectedFindings: 0, review: { findings: [finding] } });
  expect(initialize).toHaveBeenCalledWith({ apiKey: config.GEMINI_API_KEY, vertexai: false, httpOptions: { timeout: 60_000, retryOptions: { attempts: 1 } } });
  expect(generateContent).toHaveBeenCalledTimes(1);
  const request = generateContent.mock.calls[0][0];
  expect(request).toMatchObject({ model: config.GEMINI_MODEL, config: { responseMimeType: 'application/json',
    responseJsonSchema: { type: 'object', properties: { findings: { type: 'array' } } },
    systemInstruction: REVIEW_SYSTEM_INSTRUCTION, automaticFunctionCalling: { disable: true } } });
  expect(request.config.tools).toBeUndefined();
  expect(request.contents).not.toContain(config.GEMINI_API_KEY);
});
it('requires approval before initialization or requests', async () => {
  await expect(analyze({ ...options(), allowUpload: false })).rejects.toMatchObject({ code: 'UPLOAD_APPROVAL_REQUIRED' });
  expect(initialize).not.toHaveBeenCalled(); expect(generateContent).not.toHaveBeenCalled();
});
it.each([
  [{ GEMINI_API_KEY: '', GEMINI_MODEL: 'model' }, 'MISSING_API_KEY'],
  [{ GEMINI_API_KEY: 'placeholder', GEMINI_MODEL: '   ' }, 'MISSING_MODEL'],
] as const)('rejects missing AI configuration %j before initialization', async (missingConfig, code) => {
  expect(() => createAIClient(missingConfig)).toThrow();
  await expect(analyze({ ...options(), config: missingConfig })).rejects.toMatchObject({ code });
  expect(initialize).not.toHaveBeenCalled(); expect(generateContent).not.toHaveBeenCalled();
});
it.each(['not JSON', '', undefined])('rejects invalid or absent response text: %s', async text => {
  generateContent.mockResolvedValue({ text });
  await expect(analyze(options())).rejects.toMatchObject({ code: 'INVALID_AI_JSON' });
});
it.each([
  { summary: 42, findings: [] },
  { summary: 'Review', findings: [{ ...finding, severity: 'warning' }] },
  { summary: 'Review', findings: [{ ...finding, category: 'style' }] },
  { summary: 'Review', findings: [{ ...finding, title: ' ' }] },
  { summary: 'Review', findings: [{ ...finding, line: 0 }] },
  { summary: 'Review', findings: [{ ...finding, line: 1.5 }] },
])('rejects schema-invalid responses', async value => {
  generateContent.mockResolvedValue({ text: JSON.stringify(value) });
  await expect(analyze(options())).rejects.toMatchObject({ code: 'INVALID_AI_REVIEW' });
});
it.each([429, 500, undefined])('sanitizes provider errors and does not retry (%s)', async status => {
  generateContent.mockRejectedValue({ status, message: `${config.GEMINI_API_KEY} PRIVATE_SOURCE` });
  try { await analyze(options()); throw new Error('Expected failure'); }
  catch (error) {
    expect(error).toMatchObject({ code: status === 429 ? 'AI_RATE_LIMIT' : 'AI_REQUEST_FAILED' });
    expect(String(error)).not.toContain(config.GEMINI_API_KEY);
    expect(String(error)).not.toContain('PRIVATE_SOURCE');
  }
  expect(generateContent).toHaveBeenCalledTimes(1);
});
it('skips empty diffs without initializing even with missing credentials', async () => {
  expect(await analyze({ ...options(), diff: diff([]), config: { GEMINI_API_KEY: '', GEMINI_MODEL: '' } })).toMatchObject({ status: 'empty', model: null });
  expect(initialize).not.toHaveBeenCalled(); expect(generateContent).not.toHaveBeenCalled();
});
it('never uploads sensitive, binary, missing-patch, traversal or previously sensitive files', async () => {
  const excluded: DiffFile[] = [
    { ...file, path: '.env', sensitive: true, patch: 'ENV_SENTINEL' },
    { ...file, path: 'private.pem', sensitive: false, patch: 'KEY_SENTINEL' },
    { ...file, path: 'image.png', binary: true, patch: 'BINARY_SENTINEL' },
    { ...file, path: 'excluded.ts', patch: undefined },
    { ...file, path: '../unsafe.ts', patch: 'TRAVERSAL_SENTINEL' },
    { ...file, path: 'renamed.txt', oldPath: '.env', patch: 'RENAMED_SECRET_SENTINEL' },
  ];
  await analyze({ ...options(), diff: diff([file, ...excluded]) });
  const payload = JSON.parse(generateContent.mock.calls[0][0].contents);
  expect(payload.files).toHaveLength(1); expect(payload.files[0].path).toBe(file.path);
  expect(JSON.stringify(payload)).not.toContain('SENTINEL');
  initialize.mockClear(); generateContent.mockClear();
  expect(await analyze({ ...options(), diff: diff(excluded) })).toMatchObject({ status: 'no-eligible-files' });
  expect(initialize).not.toHaveBeenCalled(); expect(generateContent).not.toHaveBeenCalled();
});
it('fails before initialization for oversized input without truncation', async () => {
  await expect(analyze({ ...options(), maxInputBytes: 1 })).rejects.toMatchObject({ code: 'AI_INPUT_TOO_LARGE' });
  expect(initialize).not.toHaveBeenCalled(); expect(generateContent).not.toHaveBeenCalled();
});
it('counts UTF-8 bytes and serialized input overhead in the input limit', async () => {
  await expect(analyze({ ...options(), diff: diff([{ ...file, patch: '界'.repeat(50_000) }]), maxInputBytes: 100_000 })).rejects.toMatchObject({ code: 'AI_INPUT_TOO_LARGE' });
  expect(generateContent).not.toHaveBeenCalled();
});
it('rejects invented paths, excluded files and lines outside added ranges, recording the count', async () => {
  const bad = [
    { path: 'invented.ts' }, { path: '/src/app.ts' }, { path: 'C:\\repo\\src\\app.ts' },
    { path: '../src/app.ts' }, { path: 'src/../src/app.ts' }, { path: '.env' }, { path: 'binary.bin' },
    { line: 9 }, { line: 12 }, { line: 999999 }, { path: 'deleted.ts', line: 1 },
    { path: 'deletion-hunk.ts', line: 10 },
  ].map(overrides => ({ ...finding, ...overrides }));
  generateContent.mockResolvedValue(response([finding, { ...finding, line: 11 }, ...bad]));
  const files: DiffFile[] = [file, { ...file, path: '.env', sensitive: true }, { ...file, path: 'binary.bin', binary: true },
    { ...file, path: 'deleted.ts', status: 'deleted' },
    { ...file, path: 'deletion-hunk.ts', hunks: [{ oldStart: 10, oldLines: 1, newStart: 10, newLines: 0 }] }];
  expect(await analyze({ ...options(), diff: diff(files) })).toMatchObject({ rejectedFindings: bad.length, review: { findings: [finding, { ...finding, line: 11 }] } });
});
it('accepts no findings without fabricating any', async () => {
  generateContent.mockResolvedValue(response([]));
  expect(await analyze(options())).toMatchObject({ rejectedFindings: 0, review: { findings: [] } });
});
it('surfaces SDK JSON-envelope structured-output failures with safe diagnostics', async () => {
  generateContent.mockRejectedValue({ name: 'ApiError', status: 400, message: JSON.stringify({ error: {
    code: 400, status: 'INVALID_ARGUMENT',
    message: 'Invalid responseJsonSchema: unsupported keyword exclusiveMinimum.',
    details: [{ request: file.patch, headers: { authorization: config.GEMINI_API_KEY } }],
  } }) });
  try { await analyze(options()); throw new Error('Expected failure'); }
  catch (error) {
    expect(error).toMatchObject({ code: 'AI_REQUEST_FAILED', diagnostics: { stage: 'api-execution', httpStatus: 400,
      providerStatus: 'INVALID_ARGUMENT', providerMessage: 'Invalid responseJsonSchema: unsupported keyword exclusiveMinimum.' } });
    expect(String(error)).toContain('HTTP=400');
    expect(String(error)).toContain('INVALID_ARGUMENT');
    expect(JSON.stringify(error)).not.toContain(config.GEMINI_API_KEY);
    expect(JSON.stringify(error)).not.toContain(file.patch);
  }
  expect(generateContent).toHaveBeenCalledTimes(1);
});
it('unwraps nested proxy error envelopes and retains provider rate-limit status', async () => {
  generateContent.mockRejectedValue({ status: 429, message: JSON.stringify({ error: { code: 429, status: 'Too Many Requests',
    message: JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded for generateContent.' } }) } }) });
  await expect(analyze(options())).rejects.toMatchObject({ code: 'AI_RATE_LIMIT', diagnostics: {
    stage: 'api-execution', httpStatus: 429, providerStatus: 'RESOURCE_EXHAUSTED', providerMessage: 'Quota exceeded for generateContent.',
  } });
});
it('redacts credentials, escaped keys, submitted code and terminal controls in provider messages', async () => {
  const message = `Invalid request: ${config.GEMINI_API_KEY}; ${encodeURIComponent(config.GEMINI_API_KEY)}; ${Buffer.from(config.GEMINI_API_KEY).toString('base64')}; ${file.patch}; \u001b[31m`;
  generateContent.mockRejectedValue({ status: 400, message: JSON.stringify({ error: { code: 400, status: 'INVALID_ARGUMENT', message } }) });
  try { await analyze(options()); throw new Error('Expected failure'); }
  catch (error) {
    const output = String(error) + JSON.stringify(error);
    expect(output).not.toContain(config.GEMINI_API_KEY);
    expect(output).not.toContain(encodeURIComponent(config.GEMINI_API_KEY));
    expect(output).not.toContain(Buffer.from(config.GEMINI_API_KEY).toString('base64'));
    expect(output).not.toContain('before'); expect(output).not.toContain('after');
    expect(output).not.toContain('\u001b'); expect(output).toContain('[REDACTED]');
  }
});
it.each(['Authorization: Bearer placeholder', 'x-goog-api-key: placeholder', '{"contents": "PRIVATE_SOURCE"}', '<html>PRIVATE_SOURCE</html>'])('withholds provider header/body dumps: %s', async message => {
  generateContent.mockRejectedValue({ status: 400, message: JSON.stringify({ error: { status: 'INVALID_ARGUMENT', message } }) });
  await expect(analyze(options())).rejects.toMatchObject({ diagnostics: { providerMessage: 'Provider message withheld because it may contain credentials or request data.' } });
});
it('classifies client initialization failures without calling the API', async () => {
  initialize.mockImplementation(() => { throw new Error(config.GEMINI_API_KEY + file.patch); });
  await expect(analyze(options())).rejects.toMatchObject({ code: 'AI_CLIENT_ERROR', diagnostics: { stage: 'request-creation', providerMessage: null } });
  expect(generateContent).not.toHaveBeenCalled();
});
it('classifies synchronous invocation failures as request creation', async () => {
  generateContent.mockImplementation(() => { throw new TypeError('Untrusted local exception ' + config.GEMINI_API_KEY); });
  await expect(analyze(options())).rejects.toMatchObject({ diagnostics: { stage: 'request-creation', providerMessage: null } });
});
it.each([
  { text: '{broken source response' },
  { text: undefined },
  { text: 42 },
  null,
  { get text() { throw new Error(config.GEMINI_API_KEY); } },
])('classifies malformed responses and getter failures as parsing errors', async value => {
  generateContent.mockResolvedValue(value);
  await expect(analyze(options())).rejects.toMatchObject({ code: 'INVALID_AI_JSON', diagnostics: { stage: 'response-parsing', providerMessage: null } });
});
it.each([
  [{ text: '{', candidates: [{ finishReason: 'MAX_TOKENS' }] }, 'AI_OUTPUT_TRUNCATED'],
  [{ promptFeedback: { blockReason: 'SAFETY' } }, 'AI_OUTPUT_BLOCKED'],
  [{ candidates: [{ finishReason: 'SAFETY' }] }, 'AI_OUTPUT_BLOCKED'],
  [{ text: JSON.stringify({ summary: 'Review', findings: [{ ...finding, title: '' }] }) }, 'INVALID_AI_REVIEW'],
])('diagnoses structured-output parsing failures without exposing output', async (value, code) => {
  generateContent.mockResolvedValue(value);
  await expect(analyze(options())).rejects.toMatchObject({ code, diagnostics: { stage: 'response-parsing' } });
});
it('passes gemini-3.8-flash through without substituting another model', async () => {
  const result = await analyze({ ...options(), config: { ...config, GEMINI_MODEL: ' gemini-3.8-flash ' } });
  expect(generateContent.mock.calls[0][0].model).toBe('gemini-3.8-flash');
  expect(result.model).toBe('gemini-3.8-flash');
});
