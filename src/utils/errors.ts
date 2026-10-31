export class ReviewError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'ReviewError';
  }
}
