import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentClient } from '../src/agent.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const ipc=new AgentClient({...process.env,EVERYTHING_URL:undefined});
const url=process.env.EVERYTHING_TEST_HTTP_URL || process.env.EVERYTHING_URL;
assert.ok(url,'Set EVERYTHING_TEST_HTTP_URL to the running HTTP service for the same index.');
const http=new AgentClient({...process.env,EVERYTHING_URL:url});
const cases=[{root:path.join(root,'src'),query:'ext:js',count:50,fields:['size','date_modified']},
 {root,recursive:false,kind:'folder',count:50,fields:['size']},
 {root:path.join(root,'src'),query:'^schema\\.js$',regex:true,count:10},
 {root:path.join(root,'src'),query:'ext:js !path:node_modules',count:50}];
for(const input of cases){const a=await ipc.search(input),b=await http.search(input);assert.equal(a.total,b.total);assert.deepEqual(a,b);}
console.log(JSON.stringify({ok:true,cases:cases.length,channels:['ipc','http'],checks:['paths','counts','metadata','folder_sizes','regex','exclusion','ordering']}));
