import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createMcpServer } from '../../src/mcp/server.js';

describe('mcp server', () => {
  it('grafana_dashboard_build returns a dashboard whose title matches the input', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer();
    await server.connect(serverTransport);

    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(clientTransport);

    const result = await client.callTool({
      name: 'grafana_dashboard_build',
      arguments: { title: 'My Dashboard' },
    });

    const content = (result.content as Array<{ type: string; text?: string }>)[0];
    if (content?.type !== 'text' || typeof content.text !== 'string') {
      throw new Error('expected text content from grafana_dashboard_build');
    }
    const dashboard = JSON.parse(content.text) as { title: string };
    expect(dashboard.title).toBe('My Dashboard');
  });

  it('lists grafana_dashboard_build among its tools', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer();
    await server.connect(serverTransport);

    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(clientTransport);

    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('grafana_dashboard_build');
  });
});
