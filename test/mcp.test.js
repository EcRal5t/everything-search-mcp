import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createServer} from '../src/server.js';
import {EverythingClient,configFromEnv} from '../src/everything.js';
import {AgentClient} from '../src/agent.js';
import {AgentError} from '../src/schema.js';

const backend=()=>new EverythingClient({...configFromEnv({}),validateRoots:false},async url=>new Response(JSON.stringify({totalResults:1,results:url.searchParams.get('count')==='0'?[]:[{type:'file',name:'x.txt',path:'C:\\Test'}]})));
async function connect(server){const client=new Client({name:'test',version:'test'});const[a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);return client;}
test('three tools, typed compact results, partial batch errors and syntax resource',async()=>{
 const server=createServer(backend());const c=await connect(server);
 try{
  const tools=(await c.listTools()).tools;
  assert.deepEqual(tools.map(t=>t.name).sort(),['everything_search','everything_status','everything_storage']);
  assert.ok(tools.every(t=>t.annotations.readOnlyHint&&t.outputSchema));
  const r=await c.callTool({name:'everything_search',arguments:{requests:[{root:'C:\\Test'},{query:'content:word'}]}});
  assert.ok(!r.isError);assert.equal(r.structuredContent.results[0].base,'C:/Test');
  assert.deepEqual(r.structuredContent.results[0].rows,[['x.txt','file']]);
  assert.equal(r.structuredContent.results[1].error.code,'UNSUPPORTED_QUERY');
  assert.deepEqual(JSON.parse(r.content[0].text),r.structuredContent);
  const bad=await c.callTool({name:'everything_search',arguments:{requests:[{root:'relative'}]}});
  assert.equal(bad.isError,true);assert.equal(bad.structuredContent.results[0].error.code,'INVALID_ARGUMENT');
  const count=await c.callTool({name:'everything_search',arguments:{requests:[{count:0}]}});
  assert.deepEqual(count.structuredContent,{results:[{total:1}]});
  assert.ok(JSON.parse((await c.readResource({uri:'everything://syntax'})).contents[0].text).examples.length);
 }finally{await c.close();await server.close();}
});
test('text-only mode avoids a duplicate result and keeps the same JSON data',async()=>{
 const server=createServer(backend(),{outputFormat:'text'});const c=await connect(server);
 try{assert.ok((await c.listTools()).tools.every(t=>!t.outputSchema));const r=await c.callTool({name:'everything_search',arguments:{requests:[{count:0}]}});assert.equal(r.structuredContent,undefined);assert.deepEqual(JSON.parse(r.content[0].text),{results:[{total:1}]});}
 finally{await c.close();await server.close();}
});
test('invalid backend configuration still allows MCP discovery and diagnosis',async()=>{
 const s=createServer(new AgentClient({EVERYTHING_URL:'file:///bad'}));const c=await connect(s);
 try{assert.equal((await c.listTools()).tools.length,3);const r=await c.callTool({name:'everything_status',arguments:{}});assert.equal(r.isError,true);assert.equal(r.structuredContent.ready,false);assert.equal(r.structuredContent.problems[0].code,'INVALID_CONFIG');}
 finally{await c.close();await s.close();}
});

test('tool errors remain readable after output schema discovery',async()=>{
 const client=backend();
 client.storage=async()=>{throw new AgentError('SCAN_LIMIT','Choose a larger max_entries or allow_partial:true.');};
 const s=createServer(client);const c=await connect(s);
 try{
  await c.listTools();
  const result=await c.callTool({name:'everything_storage',arguments:{root:'C:\\Test'}});
  assert.equal(result.isError,true);
  assert.equal(JSON.parse(result.content[0].text).error.code,'SCAN_LIMIT');
 }finally{await c.close();await s.close();}
});
