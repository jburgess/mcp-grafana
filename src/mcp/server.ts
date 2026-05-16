import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { buildDashboard } from '../assets/dashboard.js';

const PACKAGE_NAME = 'mcp-grafana';
const PACKAGE_VERSION = '0.0.0';

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: PACKAGE_NAME, version: PACKAGE_VERSION });

  server.registerTool(
    'grafana_dashboard_build',
    {
      description:
        'Build a Grafana dashboard from minimal inputs. Returns the ' +
        "dashboard as JSON suitable for posting to Grafana's HTTP API " +
        'or writing to a provisioning file.',
      inputSchema: {
        title: z.string().describe('The dashboard title shown in Grafana.'),
      },
    },
    ({ title }) => {
      const dashboard = buildDashboard({ title });
      return {
        content: [{ type: 'text', text: JSON.stringify(dashboard) }],
      };
    },
  );

  return server;
}
