export type ErrorCode =
  | 'INVALID_TRANSITION'
  | 'TERMINAL_RUN'
  | 'STALE_BRIEF'
  | 'STALE_REQUEST'
  | 'WRITER_BUSY'
  | 'PERMISSION_DENIED'
  | 'AMBIGUOUS_SUBMISSION'
  | 'STOP_UNCONFIRMED'
  | 'CALLBACK_DETACHED'
  | 'WAIT_WITHOUT_PROGRESS'
  | 'INSPECT_RATE_LIMITED'
  | 'CLEANUP_PENDING'
  | 'CAPABILITY_UNSUPPORTED'
  | 'INTERNAL';

export class SpecshipError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly details?: unknown;
  constructor(code: ErrorCode, message: string, options: { retryable?: boolean; details?: unknown; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'SpecshipError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }
}

export function errorCode(error: unknown): ErrorCode {
  return error instanceof SpecshipError ? error.code : 'INTERNAL';
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function toToolError(error: unknown): { isError: true; content: Array<{ type: 'text'; text: string }> } {
  return {
    isError: true,
    content: [{
      type: 'text',
      text: JSON.stringify({
        error: {
          code: errorCode(error),
          message: errorMessage(error),
          retryable: error instanceof SpecshipError ? error.retryable : false,
          ...(error instanceof SpecshipError && error.details !== undefined ? { details: error.details } : {}),
        },
      }),
    }],
  };
}
