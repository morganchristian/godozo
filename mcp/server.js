// godozo MCP server (stdio). Exposes `notify` + `request_approval` as MCP tools
// so any MCP client — Claude Code, Cursor, Claude Desktop, Codex, ... — can
// reach a human without any client-specific code.
//
// Requires deps:  npm install   (@modelcontextprotocol/sdk, zod)
// Register (Claude Code):  claude mcp add godozo -- node /path/to/godozo/mcp/server.js
//
// NOTE: request_approval BLOCKS until the human answers. Because MCP is
// model-driven, this is a *cooperative* checkpoint — for actions that must
// never slip past a human, also gate them with a deterministic PreToolUse hook
// calling `godozo gate` (see DESIGN.md → "the prompt is the policy, the hook is
// the seatbelt").
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createGodozo } from '../src/core.js';

const gd = createGodozo();
const server = new McpServer({ name: 'godozo', version: '0.1.0' });

server.registerTool(
  'notify',
  {
    title: 'Notify the human',
    description: 'Send a one-way notification to the human (task done, FYI, error). Does not wait for a reply.',
    inputSchema: {
      message: z.string().describe('the message to send'),
      title: z.string().optional().describe('optional short headline'),
    },
  },
  async ({ message, title }) => {
    await gd.notify({ message, title });
    return { content: [{ type: 'text', text: 'sent' }] };
  },
);

server.registerTool(
  'request_approval',
  {
    title: 'Request human approval',
    description:
      'Ask the human to approve or deny an action. BLOCKS until they respond or it times out. '
      + 'Call this before any irreversible or risky action (deploys, deletes, spending money). '
      + 'Returns APPROVED, DENIED, or TIMED_OUT — respect the answer.',
    inputSchema: {
      title: z.string().describe('short summary of what needs approval'),
      detail: z.string().optional().describe('the command, diff, or context to decide on'),
      timeout_seconds: z.number().optional().describe('how long to wait (default 600)'),
    },
  },
  async ({ title, detail, timeout_seconds }) => {
    const r = await gd.requestApproval({ title, detail, timeoutSeconds: timeout_seconds });
    const verdict = r.timedOut ? 'TIMED_OUT' : (r.approved ? 'APPROVED' : 'DENIED');
    return { content: [{ type: 'text', text: JSON.stringify({ verdict, by: r.by, at: r.at }) }] };
  },
);

await server.connect(new StdioServerTransport());
