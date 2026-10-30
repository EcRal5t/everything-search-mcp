import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { pathToFileURL } from 'node:url';
import { AgentClient } from './agent.js';
import { syntax } from './everything.js';
import { compactSearch } from './compact.js';
import { errorResult, requestsSchema, diagnosticSchema, searchOutputSchema, statusOutputSchema } from './schema.js';

export const instructions = 'Search the selected live index. Combine base and relative row path for an absolute path; columns label cells. count:0 counts; recursive:false lists children. Page with next_offset and unchanged filters. Use rg for content. File/folder sizes use indexed logical bytes.';
export function createServer(client = new AgentClient()) {
  const server = new McpServer({ name: 'everything-agent', version: 'unreleased' }, { instructions });
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
  register('everything_search', 'Search indexed paths in ordered requests. count:0 counts; recursive:false browses. Sort by size for largest files; fields:["size"] also compares folders.', requestsSchema, searchOutputSchema, (args, signal) => compactSearch(client, args, signal));
  register('everything_status', 'Read the selected backend, instance, version and index readiness.', diagnosticSchema, statusOutputSchema, (args, signal) => client.status(signal, args.verbose));
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
