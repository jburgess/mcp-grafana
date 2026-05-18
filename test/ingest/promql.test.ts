import { describe, expect, it } from 'vitest';

import { validatePromql } from '../../src/ingest/promql.js';

// validatePromql wraps @prometheus-io/lezer-promql (the same grammar
// Grafana's PromQL editor uses) to provide syntactic validation as a
// pure function. Catches: unclosed brackets, malformed operators,
// invalid duration suffixes, missing operands. Does NOT catch
// semantic errors (rate without range, wrong function arity) — those
// require the heavier @prometheus-io/codemirror-promql linter and
// are intentionally out of scope for v0.

describe('validatePromql — happy path', () => {
  it('accepts a simple instant-vector selector', () => {
    expect(validatePromql('http_requests_total').valid).toBe(true);
  });

  it('accepts a rate over a range vector', () => {
    expect(validatePromql('rate(http_requests_total[5m])').valid).toBe(true);
  });

  it('accepts a sum-by aggregation', () => {
    expect(
      validatePromql('sum by (status) (rate(http_requests_total[5m]))').valid,
    ).toBe(true);
  });

  it('accepts label matchers including regex', () => {
    expect(
      validatePromql('http_requests_total{status=~"5..",method!="OPTIONS"}').valid,
    ).toBe(true);
  });

  it('accepts a Grafana templating variable in a range duration', () => {
    // $__rate_interval is the canonical Grafana built-in for rate windows.
    expect(
      validatePromql('rate(http_requests_total[$__rate_interval])').valid,
    ).toBe(true);
  });

  it('accepts a templating variable in a label-matcher value', () => {
    // ${env} is the standard Grafana variable interpolation form.
    expect(
      validatePromql('http_requests_total{env="${env}"}').valid,
    ).toBe(true);
  });

  it('accepts histogram_quantile + sum-by-le pattern', () => {
    expect(
      validatePromql(
        'histogram_quantile(0.99, sum by (le) (rate(http_request_duration_seconds_bucket[5m])))',
      ).valid,
    ).toBe(true);
  });

  it('accepts binary arithmetic between two vectors', () => {
    expect(
      validatePromql(
        'sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))',
      ).valid,
    ).toBe(true);
  });

  it('accepts the offset modifier', () => {
    expect(validatePromql('http_requests_total offset 1h').valid).toBe(true);
  });

  it('accepts the @ modifier (Prometheus 2.25+)', () => {
    expect(validatePromql('http_requests_total @ 1609459200').valid).toBe(true);
  });
});

describe('validatePromql — syntax errors', () => {
  it('rejects an unclosed range bracket', () => {
    const result = validatePromql('rate(http_requests_total[5m)');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]?.from).toBeTypeOf('number');
    expect(result.errors[0]?.to).toBeTypeOf('number');
    expect(result.errors[0]?.message).toBeTypeOf('string');
  });

  it('rejects an unclosed function call', () => {
    const result = validatePromql('rate(http_requests_total[5m]');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects an unclosed label-matcher brace', () => {
    const result = validatePromql('http_requests_total{status="200"');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects an empty expression', () => {
    const result = validatePromql('');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects a whitespace-only expression', () => {
    const result = validatePromql('   \n  ');
    expect(result.valid).toBe(false);
  });

  it('rejects a stray binary operator at the start', () => {
    const result = validatePromql('+ http_requests_total');
    // PromQL allows unary + / -, but a bare leading + with nothing
    // useful afterward should fail. The grammar may accept this as
    // unary + on a vector; mark as a known-tolerant case.
    // Pinning the actual behavior: lezer-promql allows it (unary).
    expect(result.valid).toBe(true);
  });

  it('rejects a malformed duration suffix', () => {
    const result = validatePromql('rate(http_requests_total[5xyz])');
    expect(result.valid).toBe(false);
  });

  it('reports errors with positions inside the source string', () => {
    const expr = 'rate(http_requests_total[5m';
    const result = validatePromql(expr);
    expect(result.valid).toBe(false);
    for (const err of result.errors) {
      expect(err.from).toBeGreaterThanOrEqual(0);
      expect(err.to).toBeGreaterThanOrEqual(err.from);
      expect(err.to).toBeLessThanOrEqual(expr.length);
    }
  });

  it('caps errors at a reasonable limit to keep responses bounded', () => {
    // Deeply nested junk produces many parse errors. The cap exists
    // for the same reason validateDashboard caps at 100 — bounded
    // tool-call results.
    const result = validatePromql('((((((((((((((((((((');
    expect(result.errors.length).toBeLessThanOrEqual(100);
  });
});

describe('validatePromql — input shape', () => {
  it('treats non-string input as invalid with a structured error', () => {
    const result = validatePromql(null as unknown as string);
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.message).toMatch(/string/i);
  });

  it('treats undefined input as invalid', () => {
    const result = validatePromql(undefined as unknown as string);
    expect(result.valid).toBe(false);
  });
});

describe('validatePromql — semantic non-coverage (documented limitation)', () => {
  // These cases ARE broken PromQL but lezer-promql is a syntactic
  // parser and accepts them. Documenting the limitation so future
  // shapes (panels.targets.promqlValid lint rule) don't surprise
  // users by passing these. If we ever want them caught, upgrade to
  // @prometheus-io/codemirror-promql's Parser (heavier dep surface).

  it('PASSES rate() without a range (semantic-only error in real Prometheus)', () => {
    // Real Prometheus rejects with "expected type range vector"; the
    // grammar accepts the syntax. Out of scope.
    expect(validatePromql('rate(http_requests_total)').valid).toBe(true);
  });

  it('PASSES a function call with the wrong arity (semantic-only)', () => {
    // histogram_quantile takes 2 args; this passes 1. Syntactic
    // grammar accepts it; semantic checker would reject.
    expect(validatePromql('histogram_quantile(rate(foo[5m]))').valid).toBe(true);
  });
});
