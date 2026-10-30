import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { pathToFileURL } from 'node:url';
import { AgentClient } from './agent.js';
import { syntax } from './everything.js';
import { compactSearch, compactStorage } from './compact.js';
import { errorResult,
  requestsSchema,mcpStorageSchema,diagnosticSchema,searchOutputSchema,storageOutputSchema,statusOutputSchema } from './schema.js';

export const instructions = 'Search the selected live index. Combine base and relative row path for an absolute path; columns label cells. count:0 counts; recursive:false lists children. Page with next_offset and unchanged filters. Use rg for content. File/folder sizes use indexed logical bytes.';
export function createServer(client = new AgentClient(), options = {}) {
  const textOnly = (options.outputFormat ?? process.env.EVERYTHING_OUTPUT_FORMAT) === 'text';
  const server = new McpServer({name:'everything-agent',version:'unreleased'},{instructions});
  const register = (name, description, schema, outputSchema, handler) => server.registerTool(name,{
    description,inputSchema:schema,...(!textOnly && outputSchema ? {outputSchema} : {}),
    annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},
  },async(args,extra)=>{
    try {
      let result = await handler(args,extra.signal);
      const failed = result.ok === false || result.ready === false || result.results?.every(r=>r.error);
      if (outputSchema && !failed) result = outputSchema.parse(result);
      return {content:[{type:'text',text:JSON.stringify(result)}],...(!textOnly ? {structuredContent:result} : {}),...(failed ? {isError:true} : {})};
    } catch(error) {
      const result=errorResult(error);
      return {content:[{type:'text',text:JSON.stringify(result)}],...(!textOnly ? {structuredContent:result} : {}),isError:true};
    }
  });
    register('everything_search','Search indexed paths in ordered requests. count:0 counts; recursive:false browses. PCRE via regex:true. Exclude directories with !path:node_modules.',requestsSchema,searchOutputSchema,(a,s)=>compactSearch(client,a,s));
    register('everything_storage','Largest files or directory sums in indexed logical bytes. allow_partial:true returns path-prefix lower bounds.',mcpStorageSchema,storageOutputSchema,async(a,s)=>compactStorage(await client.storage(a,s)));
  register('everything_status','Read backend, instance, version, index readiness, capabilities and repair hints.',diagnosticSchema,statusOutputSchema,async(a,s)=>{
    return client.status(s,a.verbose);
  });
  server.registerResource('everything-syntax','everything://syntax',{description:'Supported query syntax and result semantics',mimeType:'application/json'},async uri=>({contents:[{uri:uri.href,mimeType:'application/json',text:JSON.stringify(syntax)}]}));
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await createServer().connect(new StdioServerTransport()); }
  catch(error) { console.error(JSON.stringify(errorResult(error)));process.exitCode=1; }
}
