/**
 * PromQL syntactic validator. Stub for the RED commit — implementation
 * lands in the next commit.
 */

export interface PromqlError {
  /** Start offset in the source string. */
  from: number;
  /** End offset in the source string. */
  to: number;
  /** Human-readable diagnostic. */
  message: string;
}

export interface PromqlValidationResult {
  valid: boolean;
  errors: PromqlError[];
}

export function validatePromql(_expr: string): PromqlValidationResult {
  throw new Error('not implemented');
}
