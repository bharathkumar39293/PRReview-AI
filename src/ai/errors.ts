import { ReviewError } from '../utils/errors.js';

export type AIStage = 'request-creation' | 'api-execution' | 'response-parsing';
export interface AIDiagnostics {
  stage: AIStage;
  httpStatus: number | null;
  providerStatus: string | null;
  providerMessage: string | null;
}
export class AIError extends ReviewError {
  constructor(code: string, message: string, public readonly diagnostics: AIDiagnostics) {
    super(code, `${message} [stage=${diagnostics.stage}; HTTP=${diagnostics.httpStatus ?? 'unavailable'}; providerStatus=${diagnostics.providerStatus ?? 'unavailable'}]${diagnostics.providerMessage ? ` ${diagnostics.providerMessage}` : ''}`);
    this.name = 'AIError';
  }
}

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => typeof value === 'object' && value !== null ? value as ObjectValue : {};
const httpStatus = (value: unknown): number | null => typeof value === 'number' && Number.isInteger(value) && value >= 100 && value < 600 ? value : null;
const providerStatuses = new Set(['INVALID_ARGUMENT', 'FAILED_PRECONDITION', 'OUT_OF_RANGE', 'UNAUTHENTICATED', 'PERMISSION_DENIED', 'NOT_FOUND', 'ALREADY_EXISTS', 'RESOURCE_EXHAUSTED', 'CANCELLED', 'DATA_LOSS', 'UNKNOWN', 'INTERNAL', 'UNAVAILABLE', 'DEADLINE_EXCEEDED', 'UNIMPLEMENTED']);

function sanitize(message: string, privateValues: readonly string[]): string {
  // Do not display proxy/header/body dumps, even when they occur in message.
  if (/<(?:html|!doctype)|\b(?:authorization|proxy-authorization|x-goog-api-key|headers?|contents|systemInstruction|requestBody|responseBody)\s*["']?\s*[:=]/i.test(message)) {
    return 'Provider message withheld because it may contain credentials or request data.';
  }
  let safe = message;
  // Include raw and common escaped/encoded representations, before truncation.
  for (const value of [...new Set(privateValues.filter(Boolean))].sort((a, b) => b.length - a.length)) {
    for (const variant of new Set([value, JSON.stringify(value).slice(1, -1), encodeURIComponent(value), Buffer.from(value).toString('base64')])) {
      safe = safe.split(variant).join('[REDACTED]');
    }
  }
  safe = safe.replace(/\b(?:Bearer|Basic)\s+\S+/gi, '[REDACTED AUTHORIZATION]')
    .replace(/\bAIza[\w-]+/g, '[REDACTED KEY]')
    .replace(/([?&](?:key|api_key|apiKey|token)=)[^\s&#"']+/gi, '$1[REDACTED]')
    .replace(/\b(?:api[_-]?key|access[_-]?token)\s*["']?\s*[:=]\s*[^\s,;]+/gi, '[REDACTED CREDENTIAL]')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ');
  return safe.slice(0, 1000);
}

export function providerError(error: unknown, stage: AIStage, privateValues: readonly string[]): AIError {
  const outer = object(error);
  let detail = outer;
  let status = httpStatus(outer.status);
  let providerEnvelope = outer.name === 'ApiError' && status !== null;
  // The SDK stores the provider JSON envelope in ApiError.message. Some proxies
  // nest a second JSON envelope inside error.message. Never copy details/body.
  for (let depth = 0; depth < 6; depth++) {
    if (detail.error && typeof detail.error === 'object') { providerEnvelope = true; detail = object(detail.error); continue; }
    if (typeof detail.message === 'string' && detail.message.length <= 100_000) {
      try {
        const nested: unknown = JSON.parse(detail.message);
        const envelope = object(nested);
        if ((envelope.error && typeof envelope.error === 'object') ||
          (typeof envelope.message === 'string' && (httpStatus(envelope.code) !== null || typeof envelope.status === 'string'))) {
          detail = envelope; continue;
        }
      } catch { /* Plain API message, not JSON. */ }
    }
    break;
  }
  status ??= httpStatus(detail.code);
  const providerStatus = typeof detail.status === 'string' && providerStatuses.has(detail.status) ? detail.status : null;
  // Unknown transport/SDK exception messages are not provider diagnostics and
  // may contain arbitrary request data. Only expose a recognized API envelope.
  const providerMessage = providerEnvelope && typeof detail.message === 'string' ? sanitize(detail.message, privateValues) : null;
  const code = status === 429 ? 'AI_RATE_LIMIT' : stage === 'request-creation' ? 'AI_CLIENT_ERROR' : 'AI_REQUEST_FAILED';
  const message = status === 429 ? 'Gemini rate limit reached; no automatic retry was performed.' :
    stage === 'request-creation' ? 'Unable to create the Gemini request.' : 'Gemini request failed.';
  return new AIError(code, message, { stage, httpStatus: status, providerStatus, providerMessage });
}

export function parsingError(code: string, message: string): AIError {
  // JSON/Zod exceptions and response text can contain source. Only fixed local
  // explanations are used, never raw exceptions, issue values or response data.
  return new AIError(code, message, { stage: 'response-parsing', httpStatus: null, providerStatus: null, providerMessage: null });
}
