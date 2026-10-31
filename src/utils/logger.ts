// Callers pass only public, fixed messages: never configuration or source contents.
export const logger = { error: (message: string): void => { process.stderr.write(`${message}\n`); } };
