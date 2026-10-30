import {test} from 'node:test';
import assert from 'node:assert/strict';
import {IpcTransport,parseCSV} from '../src/ipc.js';
import {discoverIpc} from '../src/discovery.js';
import {configFromEnv} from '../src/everything.js';
import {AgentError} from '../src/schema.js';
import {AgentClient} from '../src/agent.js';

test('IPC uses literal argv after the switch boundary and preserves integer precision',async()=>{
 const calls=[];
 const t=new IpcTransport({executable:'es.exe',instance:'custom'},async(_e,args)=>{
  calls.push(args);return {code:0,stdout:args.includes('-get-total-size')?'9007199254740993\n':args.includes('-get-result-count')?'1\n':'Filename,Attributes,Size,Date Modified,Date Created,Date Accessed,Run Count\r\n"D:\\测试 空格\\-exit.txt",32,9007199254740993,133801632000000000,133801632000000000,133801632000000000,7\r\n'};
 });
 const query='path:"D:\\测试 空格\\" <-exit | ext:txt>';
 const r=await t.request({fields:['size','date_modified','date_created','date_accessed','attributes','run_count'],sort:'date_created'},1,query);
 assert.equal(await t.totalSize({},query),'9007199254740993');
 assert.ok(calls.every(a=>a[0]==='-argv'&&a.at(-2)==='--'&&a.at(-1)===query));
 assert.ok(calls.every(a=>a[a.indexOf('-code-page')+1]==='65001'));
 assert.equal(r.results[0].size,'9007199254740993');assert.equal(r.results[0].date_modified,'133801632000000000');
 assert.equal(r.results[0].date_created,'133801632000000000');assert.equal(r.results[0].attributes,'32');assert.equal(r.results[0].run_count,'7');
 assert.equal(calls[0][calls[0].indexOf('-sort')+1],'date-created-ascending');
 assert.deepEqual(parseCSV('a,b\r\n"x,y","z""w"\r\n'),[['a','b'],['x,y','z"w']]);
});
test('IPC folder sizes use file sums on 1.4 and indexed values on 1.5',async()=>{
 for(const version of ['1.4.1.1024','1.5.0.1409']){
  const c=new AgentClient({}, {inspect:async()=>({instances:['']}),discoverIpc:async()=>({
   info:{transport:'ipc',instance:'',version,local:false},transport:{
    request:async()=>({totalResults:1,results:[{name:'folder',path:'C:\\Test',type:'folder',size:'42'}]}),
    directorySize:async()=>'34',
   },
  })});
  assert.deepEqual((await c.search({fields:['size']})).rows,[['C:/Test/folder','folder',version.startsWith('1.4.')?34:42]]);
 }
});
test('discovery selects a custom instance and surfaces multiple indexes',async()=>{
 const config=configFromEnv({});
 const factory=({instance})=>({getVersion:async()=>{if(instance==='one'||instance==='two')return'1.5.0.1409';throw new AgentError('INSTANCE_NOT_FOUND','Choose an instance');},request:async()=>({})});
 const selected=await discoverIpc({instances:['one'],directories:[]},config,{},undefined,factory);
 assert.equal(selected.info.instance,'one');
 await assert.rejects(discoverIpc({instances:['one','two']},config,{},undefined,factory),e=>e.code==='MULTIPLE_INSTANCES');
 assert.equal((await discoverIpc({instances:['one','two']},config,{EVERYTHING_INSTANCE:'two'},undefined,factory)).info.instance,'two');
});
