import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { AgentClient } from './agent.js';
import { syntax } from './everything.js';
import { compactSearch } from './compact.js';
import { errorResult, requestsSchema, diagnosticSchema, searchOutputSchema, statusOutputSchema } from './schema.js';

export const instructions = 'Fast file search on Windows using Everything. Returns compact matrix results (base directory, column names, row arrays). Combine base with relative row paths for full paths. Use count:0 to count matches. Use recursive:false to list direct folder children.';
const { name, version = 'unreleased' } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

export function createServer(client = new AgentClient()) {
  const server = new McpServer({ name, version }, { instructions });
  const register = (name, description, inputSchema, outputSchema, handler) => server.registerTool(name, {
    description, inputSchema, outputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (args, extra) => {
    try {
      const result = outputSchema.parse(await handler(args, extra.signal));
      const failed = result.ready === false || result.results?.every(item => item.error);
      return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result, ...(failed ? { isError: true } : {}) };
    } catch (error) {
      return { content: [{ type: 'text', text: JSON.stringify(errorResult(error)) }], isError: true };
    }
  });

  register('everything_search', 'Search indexed files and folders in 1–8 requests. recursive:false lists direct children. Use count:0, kind:"file", fields:["size"] to sum matched file bytes.', requestsSchema, searchOutputSchema, (args, signal) => compactSearch(client, args, signal));
  register('everything_status', 'Check connection status, selected instance, version, and index readiness.', diagnosticSchema, statusOutputSchema, (args, signal) => client.status(signal, args.verbose));
  server.registerResource('everything-syntax', 'everything://syntax', { description: 'Query syntax and result semantics', mimeType: 'application/json' }, async uri => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(syntax) }] }));
  return server;
}

export async function startServer() {
  await createServer().connect(new StdioServerTransport());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await startServer(); }
  catch (error) { console.error(JSON.stringify(errorResult(error))); process.exitCode = 1; }
}
