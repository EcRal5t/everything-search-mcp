import { normalizeRoot, configFromEnv, composeQuery, filetimeToISO, resultPath, relativePath, logicalBytes, HttpTransport } from './everything.js';
import { inspectWindows, discoverIpc } from './discovery.js';
import { AgentError, errorResult, searchSchema } from './schema.js';
import { validateQuery, validateRoot } from './validation.js';

export class AgentClient {
  constructor(env = process.env, dependencies = {}) {
    try { this.config = configFromEnv(env); }
    catch (error) { this.configError = error; this.config = configFromEnv({}); }
    this.env = env;
    this.dependencies = dependencies;
  }
  async select(signal) {
    if (this.configError) throw this.configError;
    if (this.env.EVERYTHING_URL) {
      const transport = new HttpTransport(this.config, this.dependencies.fetch);
      return { transport, info: { transport: 'http', instance: this.env.EVERYTHING_INSTANCE ?? null, version: null, local: this.config.local, url: this.config.url } };
    }
    const inventory = this.env.EVERYTHING_INSTANCE !== undefined ? { instances: [] } : await (this.dependencies.inspect ?? inspectWindows)(this.env, signal);
    return (this.dependencies.discoverIpc ?? discoverIpc)(inventory, this.config, this.env, signal);
  }
  async ensureSelected(signal) {
    // Pin a successful selection; retry discovery after a failed connection.
    this.pending ??= this.select(signal).catch(error => { this.pending = null; throw error; });
    return this.pending;
  }
  async search(arguments_, signal) {
    const input = searchSchema.parse(arguments_);
    const deadline = AbortSignal.timeout(input.timeout_ms ?? this.config.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
    try {
      const functions = await validateQuery(input);
      if (input.root) input.root = normalizeRoot(input.root);
      const { transport, info } = await this.ensureSelected(combined);
      if (input.root && info.local) await validateRoot(input.root, Math.min(input.timeout_ms ?? this.config.timeoutMs, 3000), combined);
      if (functions.includes('dupe') && !info.version?.startsWith('1.5.')) {
        throw new AgentError('UNSUPPORTED_QUERY', 'dupe: requires a verified Everything 1.5 backend', false, 'Use IPC with Everything 1.5 to verify the query-language version.');
      }
      const count = Math.min(input.count, this.config.maxResults);
      const data = await transport.request(input, count, composeQuery(input), combined);
      if (!count) return { total: data.totalResults };
      if (!data.results.length && input.offset < data.totalResults) throw new AgentError('INCOMPLETE_PAGE', 'Repeat the query or narrow its scope to obtain the remaining results.', true);
      const rows = [];
      for (const row of data.results) {
        if (!['file', 'folder'].includes(row?.type) || typeof row.name !== 'string' || typeof row.path !== 'string') throw new AgentError('INVALID_RESPONSE', 'Expected an indexed file or folder path');
        const full = resultPath(row);
        const filename = input.root ? relativePath(input.root, full) : full;
        let size = row.size;
        if (input.fields.includes('size') && row.type === 'folder' &&
            (info.version?.startsWith('1.4.') || (info.transport === 'http' && (size == null || size === '' || String(size) === '0')))) {
          size = await transport.directorySize(full, input, combined);
        }
        rows.push([filename.replaceAll('\\', '/'), row.type,
          ...(input.fields.includes('size') ? [logicalBytes(size)] : []),
          ...(input.fields.includes('date_modified') ? [filetimeToISO(row.date_modified)] : [])]);
      }
      return {
        ...(input.root ? { base: input.root.replaceAll('\\', '/') } : {}),
        total: data.totalResults, next_offset: input.offset + rows.length < data.totalResults ? input.offset + rows.length : null,
        columns: ['path', 'type', ...(input.fields.includes('size') ? ['size_bytes'] : []), ...(input.fields.includes('date_modified') ? ['modified_utc'] : [])], rows,
        ...(count < input.count ? { limited_by: ['result_cap'] } : {}),
        ...(input.fields.includes('size') ? { size_basis: 'indexed_logical' } : {}),
      };
    } catch (error) {
      if (combined.aborted) throw new AgentError(signal?.aborted ? 'CANCELLED' : 'TIMEOUT', signal?.aborted ? 'Request cancelled' : 'Search reached its time budget; narrow the scope or increase the timeout.', true);
      throw error;
    }
  }
  async status(signal, verbose = false) {
    try {
      const { transport, info } = await this.ensureSelected(signal);
      const result = await transport.request({}, 0, '', signal);
      return { ready: true, transport: info.transport, version: info.version, instance: info.instance,
        capabilities: ['paths', 'count', 'browse', 'batch', 'file_size', 'folder_size', 'modified_time', 'pcre2_validation', ...(info.version?.startsWith('1.5.') ? ['dupe'] : [])], problems: [],
        ...(verbose ? { details: { total_indexed: result.totalResults, backend: info.url ?? 'local IPC', limits: { max_results: this.config.maxResults, output_bytes: this.config.outputBytes } } } : {}) };
    } catch (error) {
      if (signal?.aborted) throw error;
      return { ready: false, transport: null, version: null, instance: null, capabilities: [], problems: [errorResult(error).error] };
    }
  }
}
