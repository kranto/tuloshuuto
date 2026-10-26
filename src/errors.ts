/** Only these deliberately authored messages may be printed or published. */
export class SafeError extends Error {}

export function safeMessage(error: unknown): string {
  return error instanceof SafeError ? error.message : 'Unexpected operation failure.';
}
