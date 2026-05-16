import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createMcpServer } from '../../src/mcp/server.js';

async function connectedClient() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer();
  await server.connect(serverTransport);

  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(clientTransport);
  return client;
}

function textContentOf(result: unknown): string {
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    throw new Error('expected content array on tool result');
  }
  const first = content[0] as { type?: string; text?: string } | undefined;
  if (first?.type !== 'text' || typeof first.text !== 'string') {
    throw new Error('expected text content from tool');
  }
  return first.text;
}

describe('mcp server', () => {
  it('grafana_dashboard_build returns a dashboard whose title matches the input', async () => {
    const client = await connectedClient();

    const result = await client.callTool({
      name: 'grafana_dashboard_build',
      arguments: { title: 'My Dashboard' },
    });

    const dashboard = JSON.parse(textContentOf(result)) as { title: string };
    expect(dashboard.title).toBe('My Dashboard');
  });

  it('prometheus_metric_parse returns the parsed metric for the http_requests_total example', async () => {
    const client = await connectedClient();
    const text = [
      '# HELP http_requests_total The total number of processed HTTP requests.',
      '# TYPE http_requests_total counter',
      'http_requests_total{method="GET", status="200"} 15302',
      'http_requests_total{method="GET", status="404"} 14',
      'http_requests_total{method="POST", status="200"} 452',
      '',
    ].join('\n');

    const result = await client.callTool({
      name: 'prometheus_metric_parse',
      arguments: { text },
    });

    const metrics = JSON.parse(textContentOf(result)) as Array<{
      name: string;
      type: string;
      help?: string;
      labels: Record<string, string[]>;
    }>;

    expect(metrics).toHaveLength(1);
    expect(metrics[0]?.name).toBe('http_requests_total');
    expect(metrics[0]?.type).toBe('counter');
    expect(metrics[0]?.help).toBe('The total number of processed HTTP requests.');
    expect(metrics[0]?.labels).toEqual({
      method: ['GET', 'POST'],
      status: ['200', '404'],
    });
  });

  it('lists both grafana_dashboard_build and prometheus_metric_parse', async () => {
    const client = await connectedClient();

    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toContain('grafana_dashboard_build');
    expect(names).toContain('prometheus_metric_parse');
  });
});
