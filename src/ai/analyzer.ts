import { createAIClient, validateAIConfig, type AIConfig, type GeminiClient } from './client.js';
import { REVIEW_SYSTEM_INSTRUCTION, UPLOAD_NOTICE, SECRET_WARNING } from './prompt.js';
import type { DiffResult } from '../git/diff.js';
import { reviewJsonSchema, reviewSchema, type Review } from '../review/schema.js';
import { eligibleFiles, validateFindings } from '../review/validate.js';
import { ReviewError } from '../utils/errors.js';
import { AIError, providerError, parsingError } from './errors.js';
import type { GenerateContentParameters } from '@google/genai';

export interface AnalysisResult {
  status: 'reviewed' | 'empty' | 'no-eligible-files';
  model: string | null;
  review: Review | null;
  rejectedFindings: number;
}
export interface AnalyzeOptions {
  diff: DiffResult;
  allowUpload: boolean;
  config: AIConfig;
  maxInputBytes?: number;
  clientFactory?: (config: AIConfig) => GeminiClient;
}

export async function analyze(options: AnalyzeOptions): Promise<AnalysisResult> {
  if (!options.allowUpload) throw new ReviewError('UPLOAD_APPROVAL_REQUIRED', `${UPLOAD_NOTICE} ${SECRET_WARNING}`);
  const { diff } = options;
  const skipped = (status: 'empty' | 'no-eligible-files'): AnalysisResult => ({ status, model: null, review: null, rejectedFindings: 0 });
  if (diff.empty || diff.files.length === 0) return skipped('empty');
  const files = eligibleFiles(diff);
  if (!files.length) return skipped('no-eligible-files');
  const max = options.maxInputBytes ?? 131_072;
  if (!Number.isSafeInteger(max) || max < 1 || max > 100_000_000) throw new ReviewError('INVALID_AI_LIMIT', 'Invalid maximum AI input size.');
  // Explicit projection: no repo configuration, environment, binary or excluded file data.
  const contents = JSON.stringify({ files: files.map(file => ({ path: file.path, status: file.status,
    addedLineRanges: file.hunks.filter(h => h.newLines > 0).map(h => ({ start: h.newStart, count: h.newLines })), patch: file.patch })) });
  const inputBytes = Buffer.byteLength(contents) + Buffer.byteLength(REVIEW_SYSTEM_INSTRUCTION) + Buffer.byteLength(JSON.stringify(reviewJsonSchema));
  if (inputBytes > max) throw new ReviewError('AI_INPUT_TOO_LARGE', 'Eligible diff exceeds MAX_AI_INPUT_BYTES. Review a smaller commit range; no content was uploaded.');
  validateAIConfig(options.config);
  const privateValues = [options.config.GEMINI_API_KEY, contents, ...files.flatMap(file =>
    [file.patch!, ...file.patch!.split(/\r?\n/).map(line => line.replace(/^[+\- ]/, '').trim()).filter(Boolean)])];
  let client: GeminiClient;
  let request: GenerateContentParameters;
  try {
    client = (options.clientFactory ?? createAIClient)(options.config);
    request = {
      model: options.config.GEMINI_MODEL.trim(),
      contents,
      config: { systemInstruction: REVIEW_SYSTEM_INSTRUCTION, responseMimeType: 'application/json',
        responseJsonSchema: reviewJsonSchema, maxOutputTokens: 8192,
        automaticFunctionCalling: { disable: true } },
    };
  } catch (error) {
    if (error instanceof AIError) throw error;
    throw providerError(error, 'request-creation', privateValues);
  }
  let pending: ReturnType<GeminiClient['models']['generateContent']>;
  try { pending = client.models.generateContent(request); }
  catch (error) { throw providerError(error, 'request-creation', privateValues); }
  let response: Awaited<typeof pending>;
  try { response = await pending; }
  catch (error) { throw providerError(error, 'api-execution', privateValues); }
  let text: string | undefined;
  try {
    const reason = response?.candidates?.[0]?.finishReason;
    if (reason === 'MAX_TOKENS') throw parsingError('AI_OUTPUT_TRUNCATED', 'Gemini stopped at the output token limit; structured JSON may be incomplete.');
    if (response?.promptFeedback?.blockReason || (reason && reason !== 'STOP')) {
      throw parsingError('AI_OUTPUT_BLOCKED', 'Gemini did not complete the structured review (blocked or non-success finish reason).');
    }
    text = response?.text;
    if (text !== undefined && typeof text !== 'string') throw parsingError('INVALID_AI_JSON', 'Gemini returned non-text review data.');
  } catch (error) {
    if (error instanceof AIError) throw error;
    throw parsingError('INVALID_AI_JSON', 'Unable to read Gemini response text.');
  }
  let json: unknown;
  try { json = JSON.parse(text ?? ''); }
  catch { throw parsingError('INVALID_AI_JSON', 'Gemini returned an empty or invalid JSON response.'); }
  const parsed = reviewSchema.safeParse(json);
  if (!parsed.success) throw parsingError('INVALID_AI_REVIEW', 'Gemini response did not match the review schema (required fields, field types, enums or constraints).');
  const validated = validateFindings(parsed.data, diff);
  return { status: 'reviewed', model: request.model, ...validated };
}
