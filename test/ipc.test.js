import {test} from 'node:test';
import assert from 'node:assert/strict';
import {IpcTransport,parseCSV} from '../src/ipc.js';
import {discoverIpc} from '../src/discovery.js';
import {configFromEnv} from '../src/everything.js';
import {AgentError} from '../src/schema.js';

test('IPC uses literal argv after the switch boundary and preserves integer precision',async()=>{
 const calls=[];
 const t=new IpcTransport({executable:'es.exe',instance:'custom',version:'1.5.0.1409'},async(_e,args)=>{
  calls.push(args);return {code:0,stdout:args.includes('-get-result-count')?'1\n':'Filename,Attributes,Size,Date Modified\r\n"D:\\测试 空格\\-exit.txt",32,9007199254740993,133801632000000000\r\n'};
 });
 const query='path:"D:\\测试 空格\\" <-exit | ext:txt>';
 const r=await t.request({fields:['size','date_modified'],sort:'path'},1,query);
 assert.ok(calls.every(a=>a[0]==='-argv'&&a.at(-2)==='--'&&a.at(-1)===query));
 assert.ok(calls.every(a=>a[a.indexOf('-code-page')+1]==='65001'));
 assert.equal(r.data.results[0].size,'9007199254740993');assert.equal(r.data.results[0].date_modified,'133801632000000000');
 assert.deepEqual(parseCSV('a,b\r\n"x,y","z""w"\r\n'),[['a','b'],['x,y','z"w']]);
});
test('discovery selects a custom instance and surfaces multiple indexes',async()=>{
 const config=configFromEnv({});
 const factory=({instance})=>({getVersion:async()=>{if(instance==='one'||instance==='two')return'1.5.0.1409';throw new AgentError('INSTANCE_NOT_FOUND','Choose an instance');},request:async()=>({})});
 const selected=await discoverIpc({instances:['one'],directories:[]},config,{},undefined,factory);
 assert.equal(selected.info.instance,'one');
 await assert.rejects(discoverIpc({instances:['one','two']},config,{},undefined,factory),e=>e.code==='MULTIPLE_INSTANCES');
 assert.equal((await discoverIpc({instances:['one','two']},config,{EVERYTHING_INSTANCE:'two'},undefined,factory)).info.instance,'two');
});
