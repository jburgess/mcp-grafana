export type PrometheusMetricType =
  | 'counter'
  | 'gauge'
  | 'histogram'
  | 'summary'
  | 'untyped';

export interface PrometheusSample {
  labels: Record<string, string>;
  value: number;
  timestamp?: number;
}

export interface PrometheusMetric {
  name: string;
  type: PrometheusMetricType;
  help?: string;
  labels: Record<string, string[]>;
  samples: PrometheusSample[];
}

const HELP_RE = /^#\s+HELP\s+(\S+)\s+(.*)$/;
const TYPE_RE = /^#\s+TYPE\s+(\S+)\s+(\S+)\s*$/;
const SAMPLE_RE = /^([A-Za-z_:][A-Za-z0-9_:]*)(?:\{(.*)\})?\s+(\S+)(?:\s+(\d+))?\s*$/;

const KNOWN_TYPES: ReadonlySet<PrometheusMetricType> = new Set([
  'counter',
  'gauge',
  'histogram',
  'summary',
  'untyped',
]);

export function parsePrometheusText(text: string): PrometheusMetric[] {
  const metrics = new Map<string, PrometheusMetric>();

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line === '') continue;

    const helpMatch = HELP_RE.exec(line);
    if (helpMatch) {
      const [, name, help] = helpMatch;
      if (name && help !== undefined) ensure(metrics, name).help = help;
      continue;
    }

    const typeMatch = TYPE_RE.exec(line);
    if (typeMatch) {
      const [, name, typeStr] = typeMatch;
      if (name && typeStr) {
        ensure(metrics, name).type = KNOWN_TYPES.has(typeStr as PrometheusMetricType)
          ? (typeStr as PrometheusMetricType)
          : 'untyped';
      }
      continue;
    }

    if (line.startsWith('#')) continue;

    const sampleMatch = SAMPLE_RE.exec(line);
    if (!sampleMatch) continue;

    const [, name, labelsStr, valueStr, timestampStr] = sampleMatch;
    if (!name || !valueStr) continue;

    const metric = ensure(metrics, name);
    const labels = parseLabels(labelsStr);
    const value = parseSampleValue(valueStr);
    const sample: PrometheusSample = { labels, value };
    if (timestampStr) sample.timestamp = Number.parseInt(timestampStr, 10);
    metric.samples.push(sample);

    for (const [labelName, labelValue] of Object.entries(labels)) {
      const seen = metric.labels[labelName] ?? [];
      if (!seen.includes(labelValue)) seen.push(labelValue);
      metric.labels[labelName] = seen;
    }
  }

  for (const metric of metrics.values()) {
    for (const labelName of Object.keys(metric.labels)) {
      metric.labels[labelName]!.sort();
    }
  }

  return Array.from(metrics.values());
}

function ensure(map: Map<string, PrometheusMetric>, name: string): PrometheusMetric {
  let metric = map.get(name);
  if (!metric) {
    metric = { name, type: 'untyped', labels: {}, samples: [] };
    map.set(name, metric);
  }
  return metric;
}

function parseLabels(labelsStr: string | undefined): Record<string, string> {
  if (!labelsStr) return {};
  const labels: Record<string, string> = {};
  // v0 scope: comma-separated, double-quoted values, simple escapes.
  // Does not handle commas/quotes inside escaped label values.
  for (const pair of labelsStr.split(',')) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx === -1) continue;
    const key = pair.slice(0, eqIdx).trim();
    let value = pair.slice(eqIdx + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    value = value.replace(/\\"/g, '"').replace(/\\\\/g, '\\').replace(/\\n/g, '\n');
    if (key) labels[key] = value;
  }
  return labels;
}

function parseSampleValue(s: string): number {
  if (s === '+Inf') return Number.POSITIVE_INFINITY;
  if (s === '-Inf') return Number.NEGATIVE_INFINITY;
  if (s === 'NaN') return Number.NaN;
  return Number.parseFloat(s);
}
