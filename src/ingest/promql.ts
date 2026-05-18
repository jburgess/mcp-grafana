/**
 * PromQL syntactic validator. Wraps `@prometheus-io/lezer-promql` —
 * the same Lezer grammar Grafana's PromQL editor, Mimir's editor,
 * and the Prometheus UI all build on — to give callers a pure-function
 * "did this parse?" answer with positions.
 *
 * Scope: **syntactic** only. Catches unclosed brackets, malformed
 * durations, missing operands, broken operator chains — anything the
 * grammar marks with an error node. Does NOT catch semantic errors
 * (`rate(foo)` without a range vector, wrong function arity, type
 * mismatches). The richer diagnostics live in
 * `@prometheus-io/codemirror-promql`'s `Parser` class, which requires
 * a CodeMirror `EditorState` and pulls in a ~500KB dep surface.
 * Defer that until a real workflow demands semantic checks.
 *
 * Grafana templating variables (`$var`, `${var}`, `$__rate_interval`)
 * parse cleanly under the grammar — they're indistinguishable from
 * normal label values / durations after Grafana's pre-render
 * interpolation, so the grammar doesn't reject them.
 *
 * Implementation notes:
 *   - `parser.parse(expr)` returns a Lezer `Tree`. Error nodes are
 *     marked with `node.type.isError`.
 *   - Position reporting: `from` and `to` are character offsets into
 *     the source string. Lezer error nodes can be zero-length
 *     ("missing token" markers); we clamp to non-negative.
 *   - Empty / whitespace-only input is rejected with a synthetic
 *     error — the grammar parses empty input as a single error node
 *     but the message it produces is unhelpful; the synthetic
 *     message is more LLM-actionable.
 *   - Errors are capped at MAX_ERRORS so a pathological input
 *     (`((((((((((((((((((((`) doesn't return a 200-element array.
 */

import { parser } from '@prometheus-io/lezer-promql';

// Grafana templating variable forms, matching the same syntax the
// rest of the codebase already handles (cf. validate.ts VAR_RE).
//   $name              — bare
//   ${name}            — braced (optionally with :format suffix)
//   [[name]]           — legacy
// Stored dashboard expressions carry the un-interpolated form;
// Grafana substitutes the real value at query time. The Lezer
// grammar doesn't know about Grafana — without a pre-substitution
// pass, every panel that uses `$__rate_interval` (the canonical
// Grafana built-in for rate windows) would lint-fail.
const GRAFANA_VAR_RE = /\$\{[^}]+\}|\$[a-zA-Z_][a-zA-Z0-9_]*|\[\[[^\]]+\]\]/g;

/**
 * Pre-computes "inside an open `[`" depth for every position in the
 * expression. Brackets nest in PromQL (`[5m:30s]` is a subquery —
 * range, then step), so the depth tracking is bracket-count rather
 * than a single bool. Skips bracket chars inside string literals so
 * `foo{label="["}` doesn't false-trigger duration context.
 */
function bracketDepthAt(expr: string): number[] {
  const depth: number[] = new Array(expr.length + 1).fill(0);
  let d = 0;
  let inString = false;
  let stringQuote = '';
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    depth[i] = d;
    if (inString) {
      if (ch === '\\') {
        // Escape — skip the next char.
        i++;
        if (i < expr.length) depth[i] = d;
        continue;
      }
      if (ch === stringQuote) {
        inString = false;
        stringQuote = '';
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = true;
      stringQuote = ch;
      continue;
    }
    if (ch === '[') d++;
    else if (ch === ']' && d > 0) d--;
  }
  depth[expr.length] = d;
  return depth;
}

/**
 * Substitutes Grafana templating variables with grammar-safe
 * placeholders so the Lezer parser doesn't choke on them. Two cases:
 *   - Inside an open `[...]` (range or subquery duration position):
 *     substitute with `1m`. The grammar expects `<number><unit>` and
 *     subquery step positions (`[5m:$step]`) are inside the same
 *     unclosed bracket, so the bracket-depth check catches both.
 *   - Elsewhere (identifier / metric name / label position):
 *     substitute with `_gfvar` (a valid PromQL identifier).
 *
 * Positions in the substituted string don't align with positions in
 * the original — the substitution can change length. We report
 * positions back in the ORIGINAL string by tracking the cumulative
 * offset delta. Good enough for "the broken span is here-ish";
 * Grafana variables themselves are never the source of real errors.
 */
function substituteGrafanaVariables(expr: string): { substituted: string; offsetMap: number[] } {
  // offsetMap[i] = original position corresponding to substituted position i.
  // Built incrementally as we copy and substitute.
  const offsetMap: number[] = [];
  let out = '';
  let lastEnd = 0;
  const depth = bracketDepthAt(expr);

  GRAFANA_VAR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = GRAFANA_VAR_RE.exec(expr)) !== null) {
    // Copy the chunk before the variable verbatim.
    for (let i = lastEnd; i < m.index; i++) {
      offsetMap.push(i);
      out += expr[i];
    }
    // Duration context = we're inside an open `[`. Covers both
    // range-vector `[5m]` and subquery step `[5m:$step]` positions.
    const isDurationContext = (depth[m.index] ?? 0) > 0;
    const placeholder = isDurationContext ? '1m' : '_gfvar';
    for (let i = 0; i < placeholder.length; i++) {
      // Map every char of the placeholder to the variable's start.
      offsetMap.push(m.index);
      out += placeholder[i];
    }
    lastEnd = m.index + m[0].length;
  }
  // Tail.
  for (let i = lastEnd; i < expr.length; i++) {
    offsetMap.push(i);
    out += expr[i];
  }
  return { substituted: out, offsetMap };
}

export interface PromqlError {
  /** Start offset in the source string. */
  from: number;
  /** End offset in the source string (>= from; equal when the parser flagged a "missing token" point). */
  to: number;
  /** Human-readable diagnostic. */
  message: string;
}

export interface PromqlValidationResult {
  valid: boolean;
  errors: PromqlError[];
}

const MAX_ERRORS = 100;

export function validatePromql(expr: string): PromqlValidationResult {
  if (typeof expr !== 'string') {
    return {
      valid: false,
      errors: [
        {
          from: 0,
          to: 0,
          message: 'expr must be a string',
        },
      ],
    };
  }

  if (expr.trim().length === 0) {
    return {
      valid: false,
      errors: [
        {
          from: 0,
          to: expr.length,
          message: 'PromQL expression is empty',
        },
      ],
    };
  }

  const { substituted, offsetMap } = substituteGrafanaVariables(expr);
  const tree = parser.parse(substituted);
  const errors: PromqlError[] = [];

  // Lezer's tree cursor walks every node. Error nodes carry
  // `type.isError`; their from/to mark the span the parser found
  // problematic. Zero-length error nodes are "missing-token" markers
  // (e.g. an expected closing bracket that never appeared) — keep
  // them; the position is the useful signal. Positions are
  // translated back to the original string via offsetMap so the
  // caller sees offsets into the source they passed in.
  const cursor = tree.cursor();
  cursor.iterate(
    (node) => {
      if (errors.length >= MAX_ERRORS) return false;
      if (!node.type.isError) return undefined;
      const subFrom = Math.max(0, node.from);
      const subTo = Math.max(subFrom, node.to);
      // Map substituted-string positions back to original-string
      // positions. Clamp to length when the error is at the end.
      const from =
        subFrom < offsetMap.length ? (offsetMap[subFrom] as number) : expr.length;
      const to =
        subTo < offsetMap.length
          ? (offsetMap[subTo] as number)
          : subTo === offsetMap.length
            ? expr.length
            : expr.length;
      errors.push({
        from,
        to: Math.max(from, to),
        message: messageForErrorNode(expr, from, Math.max(from, to)),
      });
      return undefined;
    },
    () => undefined,
  );

  if (errors.length === 0) {
    return { valid: true, errors: [] };
  }
  return { valid: false, errors };
}

/**
 * Produces a human-readable diagnostic for an error-node span. Lezer
 * doesn't carry per-error messages (it's a generic grammar runtime);
 * we synthesise a message from the source context. Keeps the output
 * actionable for an LLM without inventing detail the parser didn't
 * provide.
 */
function messageForErrorNode(expr: string, from: number, to: number): string {
  if (from >= expr.length) {
    return `unexpected end of expression at position ${from}`;
  }
  if (to === from) {
    // Zero-length error — "missing token" at this point.
    const context = expr.slice(Math.max(0, from - 8), Math.min(expr.length, from + 8));
    return `missing token at position ${from} (near "${context}")`;
  }
  const span = expr.slice(from, Math.min(to, from + 32));
  return `PromQL syntax error at position ${from}–${to} ("${span}")`;
}
