// A stand-in GitHub MCP server for scripts/agent-test.mjs. It speaks just enough MCP
// (stdio, JSON-RPC) to offer create_pull_request, and records each call to
// $FAKE_GITHUB_LOG instead of touching GitHub.
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const log = process.env.FAKE_GITHUB_LOG;
const send = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');

const TOOLS = [
  {
    name: 'create_pull_request',
    description: 'Create a new pull request in a GitHub repository.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string' },
        repo: { type: 'string' },
        title: { type: 'string' },
        body: { type: 'string', description: 'PR description (markdown)' },
        head: { type: 'string', description: 'Branch with the changes' },
        base: { type: 'string', description: 'Branch to merge into' },
      },
      required: ['owner', 'repo', 'title', 'head', 'base'],
    },
  },
];

createInterface({ input: process.stdin }).on('line', (line) => {
  let req;
  try {
    req = JSON.parse(line);
  } catch {
    return;
  }
  if (req.id === undefined) return; // notifications
  if (req.method === 'initialize') {
    send({ id: req.id, result: { protocolVersion: req.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'github', version: '0.0.0' } } });
  } else if (req.method === 'tools/list') {
    send({ id: req.id, result: { tools: TOOLS } });
  } else if (req.method === 'tools/call') {
    if (log) appendFileSync(log, JSON.stringify(req.params) + '\n');
    send({ id: req.id, result: { content: [{ type: 'text', text: 'Created pull request #1: https://github.com/acme/api/pull/1' }] } });
  } else {
    send({ id: req.id, error: { code: -32601, message: `unknown method ${req.method}` } });
  }
});
