import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const c=new Client({name:'live-check',version:'test'});
await c.connect(new StdioClientTransport({command:process.execPath,args:[path.join(root,'src/cli.js')],stderr:'pipe'}));
const call=async(name,args={})=>{const r=await c.callTool({name,arguments:args});assert.ok(!r.isError,JSON.stringify(r));return r.structuredContent;};
try{
 assert.equal((await c.listTools()).tools.length,3);
 const status=await call('everything_status',{verbose:true});assert.equal(status.ready,true);
 const scope=path.join(root,'src');
 const args={root:scope,query:'ext:js',count:2,fields:['size','date_modified']};
 const first=(await call('everything_search',{requests:[args]})).results[0];assert.equal(first.rows.length,2);
 const second=(await call('everything_search',{requests:[{...args,offset:first.next_offset}]})).results[0];
 assert.ok(second.rows.every(r=>!first.rows.some(x=>x[0]===r[0])));
 const batch=(await call('everything_search',{requests:[{root:scope,query:'ext:js',count:0},{root:scope,recursive:false,count:20},{root:scope,query:'^schema\\.js$',regex:true}]})).results;
 assert.equal(batch[0].total,first.total);assert.ok(batch[1].rows.some(r=>r[0]==='schema.js'));assert.deepEqual(batch[2].rows.map(r=>r[0]),['schema.js']);
 const storage=await call('everything_storage',{root:scope,mode:'directories',max_entries:1000});assert.equal(storage.status,'complete');assert.ok(storage.indexed_logical_bytes>0);
 const top=await call('everything_storage',{root:scope,top:2});assert.equal(top.largest_files.length,2);assert.ok(top.largest_files[0].indexed_logical_bytes>=top.largest_files[1].indexed_logical_bytes);
 const missing=await c.callTool({name:'everything_search',arguments:{requests:[{root:scope+'-missing'}]}});assert.equal(missing.isError,true);
 await c.readResource({uri:'everything://syntax'});
 console.log(JSON.stringify({ok:true,transport:status.transport,instance:status.instance,version:status.version,checks:['stdio','three_tools','typed_output','pagination','count','browse','regex','batch','storage','largest_files','missing_root','resource']}));
}finally{await c.close();}
