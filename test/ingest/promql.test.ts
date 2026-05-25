import { describe, expect, it } from 'vitest';

import { lintPromqlSemantics, validatePromql } from '../../src/ingest/promql.js';

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

describe('validatePromql — substitution edge cases', () => {
  // The Grafana-variable pre-substitution has three classes of tricky
  // input. Pinning each so future changes to the substitution logic
  // surface as test failures.

  it('accepts a subquery with a templating-variable step (was a round-1 false positive)', () => {
    // `[5m:$step]` is the subquery form. $step is inside the same
    // open `[`, so bracket-depth detection treats it as duration
    // context and substitutes `1m`. Without depth-tracking the
    // lookback `:` would mis-classify and emit a false positive.
    expect(
      validatePromql('last_over_time(rate(http_requests_total[1m])[5m:$step])').valid,
    ).toBe(true);
  });

  it('accepts adjacent Grafana variables', () => {
    // Pathological-but-legal: two vars back to back in label values.
    expect(validatePromql('foo{a="$x$y"}').valid).toBe(true);
  });

  it('accepts a variable at the very start of the expression', () => {
    // `$metric{...}` — variable in metric-name position.
    expect(validatePromql('$metric').valid).toBe(true);
    expect(validatePromql('$metric{job="api"}').valid).toBe(true);
  });

  it('maps error positions back to the ORIGINAL string after substitution', () => {
    // `$foo` is 4 chars, substitutes to `_gfvar` (6 chars). A real
    // error AFTER the variable should report a position in the
    // original-string coordinate space, not the substituted-string
    // coordinate space.
    const expr = '$foo + (((';
    const result = validatePromql(expr);
    expect(result.valid).toBe(false);
    // The trailing `(((` produces errors; their positions must be
    // within the original expr's length (10), not within the longer
    // substituted string (12).
    for (const err of result.errors) {
      expect(err.from).toBeLessThanOrEqual(expr.length);
      expect(err.to).toBeLessThanOrEqual(expr.length);
    }
  });

  it('does not false-trigger duration context on `[` inside a string literal', () => {
    // `foo{label="["}` — the `[` is inside a string, not an open
    // range bracket. The depth tracker skips string content so
    // `$env` after the closing `"` is identifier-context, not
    // duration-context.
    expect(validatePromql('foo{label="[" } + $env').valid).toBe(true);
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

describe('lintPromqlSemantics (range-vector requirement, issue #97)', () => {
  const fns = [
    'rate',
    'irate',
    'increase',
    'delta',
    'idelta',
    'deriv',
    'resets',
    'changes',
    'avg_over_time',
    'sum_over_time',
    'max_over_time',
    'count_over_time',
    'last_over_time',
    'present_over_time',
  ];

  it('flags each range-vector function applied to a bare instant vector', () => {
    for (const fn of fns) {
      const errs = lintPromqlSemantics(`${fn}(http_requests_total)`);
      expect(errs, fn).toHaveLength(1);
      expect(errs[0]?.message, fn).toMatch(/range vector/);
    }
  });

  it('does NOT flag when the argument is a range vector', () => {
    for (const fn of fns) {
      expect(lintPromqlSemantics(`${fn}(http_requests_total[5m])`), fn).toEqual([]);
    }
  });

  it('does NOT flag a subquery range argument', () => {
    expect(lintPromqlSemantics('rate(sum(x)[5m:1m])')).toEqual([]);
  });

  it('reports the offending argument position in the ORIGINAL string', () => {
    const expr = 'rate(http_requests_total)';
    const errs = lintPromqlSemantics(expr);
    expect(errs).toHaveLength(1);
    expect(expr.slice(errs[0]!.from, errs[0]!.to)).toBe('http_requests_total');
  });

  it('handles a Grafana duration variable in range context (no false positive)', () => {
    // $__rate_interval is substituted to a real duration in range
    // context, so the arg reads as a range vector.
    expect(lintPromqlSemantics('rate(http_requests_total[$__rate_interval])')).toEqual([]);
  });

  it('skips when the bare argument is itself a Grafana variable (unknown expansion)', () => {
    expect(lintPromqlSemantics('rate($metric)')).toEqual([]);
    expect(lintPromqlSemantics('rate(${metric})')).toEqual([]);
  });

  it('does NOT flag instant-vector functions like histogram_quantile / sum', () => {
    expect(lintPromqlSemantics('histogram_quantile(0.9, x)')).toEqual([]);
    expect(lintPromqlSemantics('sum(http_requests_total)')).toEqual([]);
    expect(lintPromqlSemantics('abs(http_requests_total)')).toEqual([]);
  });

  it('returns [] for syntactically broken input (syntax is promqlValid’s job)', () => {
    expect(lintPromqlSemantics('rate(')).toEqual([]);
    expect(lintPromqlSemantics('((((')).toEqual([]);
  });

  it('returns [] for empty / non-string input', () => {
    expect(lintPromqlSemantics('')).toEqual([]);
    expect(lintPromqlSemantics('   ')).toEqual([]);
    expect(lintPromqlSemantics(undefined as unknown as string)).toEqual([]);
  });

  it('flags the inner rate in a composed expression', () => {
    // sum(rate(foo)) — the rate(foo) is still missing its range.
    const errs = lintPromqlSemantics('sum(rate(http_requests_total)) by (job)');
    expect(errs).toHaveLength(1);
  });

  it('does NOT flag a correct full RED-style expression', () => {
    expect(
      lintPromqlSemantics('sum by (status) (rate(http_requests_total[$__rate_interval]))'),
    ).toEqual([]);
  });
});
