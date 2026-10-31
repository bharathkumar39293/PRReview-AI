import { GoogleGenAI, type GenerateContentParameters } from '@google/genai';
import { ReviewError } from '../utils/errors.js';
import { providerError } from './errors.js';

export interface AIConfig { GEMINI_API_KEY: string; GEMINI_MODEL: string }
// A narrow SDK boundary also allows tests to supply a client without network access.
export interface GeminiClient {
  models: { generateContent: (request: GenerateContentParameters) => Promise<{
    text?: string;
    candidates?: { finishReason?: string }[];
    promptFeedback?: { blockReason?: string };
  }> };
}

export function validateAIConfig(config: AIConfig): void {
  if (!config.GEMINI_API_KEY.trim()) throw new ReviewError('MISSING_API_KEY', 'Set GEMINI_API_KEY before requesting an AI review.');
  if (!config.GEMINI_MODEL.trim()) throw new ReviewError('MISSING_MODEL', 'Set GEMINI_MODEL before requesting an AI review.');
}

// Called only after the approval, eligibility, and input-size checks in analyze().
export function createAIClient(config: AIConfig): GeminiClient {
  validateAIConfig(config);
  try {
    return new GoogleGenAI({ apiKey: config.GEMINI_API_KEY, vertexai: false,
      httpOptions: { timeout: 60_000, retryOptions: { attempts: 1 } } });
  } catch (error) {
    throw providerError(error, 'request-creation', [config.GEMINI_API_KEY]);
  }
}
