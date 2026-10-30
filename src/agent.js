import { EverythingClient, configFromEnv, composeQuery } from './everything.js';
import { inspectWindows, discoverIpc, findHttp } from './discovery.js';
import { AgentError, errorResult } from './schema.js';
import { queryFunctions } from './validation.js';

export class AgentClient extends EverythingClient {
  constructor(env = process.env, dependencies = {}) {
    // Defer bad configuration until a tool call so doctor and MCP discovery remain available.
    let config, configError;
    try { config = configFromEnv(env); } catch(error) { configError = error; config = configFromEnv({}); }
    super(config);
    this.env = env; this.dependencies = dependencies; this.configError = configError;
  }
  async select(signal) {
    if (this.selected) return this.selected;
    if (this.configError) throw this.configError;
    const mode = this.env.EVERYTHING_TRANSPORT || (this.env.EVERYTHING_URL ? 'http' : 'auto');
    if (!['auto','ipc','http'].includes(mode)) throw new AgentError('INVALID_CONFIG','EVERYTHING_TRANSPORT must be auto, ipc or http');
    const selectHttp = async (endpoint, instance = null) => {
      const config = {...this.config,url:endpoint,validateRoots:['127.0.0.1','localhost','[::1]'].includes(new URL(endpoint).hostname)};
      const client = new EverythingClient(config, this.dependencies.fetch);
      await client.count({},signal);
      return {transport:client,info:{transport:'http',instance,version:null,local:config.validateRoots,url:endpoint}};
    };
    if (mode === 'http' && this.env.EVERYTHING_URL) {
      this.selected = await selectHttp(this.config.url,this.env.EVERYTHING_INSTANCE ?? null);
      return this.selected;
    }
    let inventory = {instances:[],directories:[]}, ipcError;
    if (process.platform === 'win32' || this.dependencies.inspect) {
      try { inventory = await (this.dependencies.inspect ?? inspectWindows)(this.env,signal); }
      catch(error) { ipcError = error; if (error.code === 'CANCELLED') throw error; }
      if (mode !== 'http') try {
        this.selected = await (this.dependencies.discoverIpc ?? discoverIpc)(inventory,this.config,this.env,signal);
        this.config.validateRoots = true;
        return this.selected;
      } catch(error) {
        ipcError = error;
        if (mode === 'ipc' || ['CANCELLED','MULTIPLE_INSTANCES'].includes(error.code)) throw error;
      }
    }
    if (mode === 'ipc') throw ipcError ?? new AgentError('PLATFORM_SELECTION','Use Windows for local IPC, or select an HTTP endpoint.');
    const endpoints = this.env.EVERYTHING_URL ? [{url:this.config.url,instance:this.env.EVERYTHING_INSTANCE ?? null}]
      : await (this.dependencies.findHttp ?? findHttp)(inventory,this.env);
    // Never guess a common port or start a network service as a search side effect.
    const available = [];
    for (const endpoint of endpoints) {
      try { available.push(await selectHttp(endpoint.url,endpoint.instance)); }
      catch(error) { if (error.code === 'CANCELLED') throw error; }
    }
    if (available.length > 1) throw new AgentError('MULTIPLE_INSTANCES','Multiple HTTP endpoints are available',false,'Set EVERYTHING_URL to choose the intended index.');
    if (available.length) { this.selected = available[0]; return this.selected; }
    throw ipcError ?? new AgentError('BACKEND_UNAVAILABLE','Choose a reachable Everything backend',true,'On Windows start Everything; for a remote server set EVERYTHING_URL.');
  }
  async prepare(input, signal) {
    // Validate before discovery, but root checks must use the selected backend's locality.
    const { validateQuery } = await import('./validation.js');
    await validateQuery(input);
    const selected = await this.ensureSelected(signal);
    this.config.validateRoots = selected.info.local;
    await super.prepare(input,signal);
    if (!input.regex && queryFunctions(input.query).includes('dupe')) {
      const version = selected.info.version;
      if (!version || (version.startsWith('1.') && Number(version.split('.')[1]) < 5)) throw new AgentError('UNSUPPORTED_QUERY','dupe: requires a verified Everything 1.5 backend',false,'Use IPC with Everything 1.5 to verify the query-language version.');
    }
  }
  async ensureSelected(signal) {
    // Selection is serialized and pinned; a failed search never changes indexes.
    if (!this.pending) this.pending = this.select(signal).catch(error=>{this.pending=null;throw error;});
    return this.pending;
  }
  async request(input,count,signal) {
    const selected = await this.ensureSelected(signal);
    if (selected.info.transport === 'ipc') return selected.transport.request(input,count,composeQuery(input),signal);
    const deadline = AbortSignal.timeout(input.timeout_ms ?? this.config.timeoutMs);
    const combined = signal ? AbortSignal.any([signal,deadline]) : deadline;
    const result = await selected.transport.request(input,count,combined);
    if (input.fields?.includes('size')) for (const row of result.data.results) {
      if (row.type === 'folder' && (row.size == null || row.size === '' || String(row.size) === '0')) {
        const root = row.path ? `${row.path}\\${row.name}` : `${row.name}\\`;
        const sum = await selected.transport.storage({root,mode:'directories',depth:1,top:1,max_entries:100000,timeout_ms:input.timeout_ms ?? this.config.timeoutMs},combined);
        if (!sum.size_complete) throw new AgentError('METADATA_PENDING','Directory size metadata is being gathered',true,'Wait for the index metadata to finish, then repeat the query.');
        row.size = String(sum.indexed_logical_bytes);
      }
    }
    return result;
  }
  async status(signal, verbose = false) {
    try {
      const selected = await this.ensureSelected(signal);
      const result = await this.request({query:'',kind:'any',recursive:true},0,signal);
      return {ready:true,transport:selected.info.transport,version:selected.info.version,instance:selected.info.instance,
        capabilities:['paths','count','browse','batch','file_size','modified_time','pcre2_validation','logical_storage',...(selected.info.version?.startsWith('1.5.') ? ['dupe'] : [])],problems:[],
        ...(verbose ? {details:{total_indexed:result.data.totalResults,backend:selected.info.url ?? 'local IPC',limits:{max_results:this.config.maxResults,output_bytes:this.config.outputBytes},index_scope:'selected live index with real-time updates'}} : {})};
    } catch(error) {
      if (error.code === 'CANCELLED') throw error;
      return {ready:false,transport:null,version:null,instance:null,capabilities:[],problems:[errorResult(error).error]};
    }
  }
}
