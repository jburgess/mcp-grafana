import { describe, expect, it } from 'vitest';

import { parsePrometheusText } from '../../src/ingest/prometheus.js';

describe('parsePrometheusText', () => {
  it('parses a counter metric with HELP, TYPE, and labeled samples', () => {
    const text = [
      '# HELP http_requests_total The total number of processed HTTP requests.',
      '# TYPE http_requests_total counter',
      'http_requests_total{method="GET", status="200"} 15302',
      'http_requests_total{method="GET", status="404"} 14',
      'http_requests_total{method="POST", status="200"} 452',
      '',
    ].join('\n');

    const metrics = parsePrometheusText(text);
    expect(metrics).toHaveLength(1);

    const metric = metrics[0];
    expect(metric).toBeDefined();
    expect(metric?.name).toBe('http_requests_total');
    expect(metric?.type).toBe('counter');
    expect(metric?.help).toBe('The total number of processed HTTP requests.');
    expect(metric?.labels).toEqual({
      method: ['GET', 'POST'],
      status: ['200', '404'],
    });
    expect(metric?.samples).toHaveLength(3);
    expect(metric?.samples[0]).toEqual({
      labels: { method: 'GET', status: '200' },
      value: 15302,
    });
  });

  it('parses multiple metrics in a single input', () => {
    const text = [
      '# HELP http_requests_total Total HTTP requests',
      '# TYPE http_requests_total counter',
      'http_requests_total{} 1',
      '# HELP cpu_usage_ratio CPU utilization 0-1',
      '# TYPE cpu_usage_ratio gauge',
      'cpu_usage_ratio 0.42',
      '',
    ].join('\n');

    const metrics = parsePrometheusText(text);
    expect(metrics).toHaveLength(2);
    expect(metrics.map((m) => m.name).sort()).toEqual(['cpu_usage_ratio', 'http_requests_total']);
    expect(metrics.find((m) => m.name === 'cpu_usage_ratio')?.type).toBe('gauge');
  });

  it('defaults type to "untyped" when no # TYPE line is provided', () => {
    const text = 'some_metric 42\n';
    const metrics = parsePrometheusText(text);
    expect(metrics).toHaveLength(1);
    expect(metrics[0]?.type).toBe('untyped');
    expect(metrics[0]?.help).toBeUndefined();
  });

  it('returns an empty array for empty input', () => {
    expect(parsePrometheusText('')).toEqual([]);
    expect(parsePrometheusText('\n\n  \n')).toEqual([]);
  });

  it('handles a metric without labels', () => {
    const text = '# TYPE process_uptime_seconds gauge\nprocess_uptime_seconds 1234.5\n';
    const metrics = parsePrometheusText(text);
    expect(metrics).toHaveLength(1);
    expect(metrics[0]?.labels).toEqual({});
    expect(metrics[0]?.samples).toEqual([{ labels: {}, value: 1234.5 }]);
  });

  it('produces deterministic output (label values sorted)', () => {
    const text = [
      '# TYPE m counter',
      'm{l="z"} 1',
      'm{l="a"} 2',
      'm{l="m"} 3',
      '',
    ].join('\n');

    const first = parsePrometheusText(text);
    const second = parsePrometheusText(text);
    expect(first).toEqual(second);
    expect(first[0]?.labels.l).toEqual(['a', 'm', 'z']);
  });
});
