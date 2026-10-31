import { normalizeRoot, configFromEnv, composeQuery, filetimeToISO, resultPath, relativePath, logicalBytes, HttpTransport } from './everything.js';
import { inspectWindows, discoverIpc } from './discovery.js';
import { AgentError, errorResult, searchSchema } from './schema.js';
import { validateQuery, validateRoot } from './validation.js';

const metadata = [
  ['size', 'size_bytes', logicalBytes],
  ['date_modified', 'modified_utc', filetimeToISO],
  ['date_created', 'created_utc', filetimeToISO],
  ['date_accessed', 'accessed_utc', filetimeToISO],
  ['attributes', 'attributes', logicalBytes],
  ['run_count', 'run_count', logicalBytes],
];

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
      const sumSize = input.count === 0 && input.fields.includes('size');
      if (sumSize && input.kind !== 'file') throw new AgentError('INVALID_ARGUMENT', 'Use kind:"file" with count:0 and fields:["size"] to sum matching file bytes. Folder sizes are available in result rows.');
      if (input.root) input.root = normalizeRoot(input.root);
      const { transport, info } = await this.ensureSelected(combined);
      if (input.root && info.local) await validateRoot(input.root, Math.min(input.timeout_ms ?? this.config.timeoutMs, 3000), combined);
      if (functions.includes('dupe') && !info.version?.startsWith('1.5.')) {
        throw new AgentError('UNSUPPORTED_QUERY', 'dupe: requires a verified Everything 1.5 backend', false, 'Use IPC with Everything 1.5 to verify the query-language version.');
      }
      const count = Math.min(input.count, this.config.maxResults);
      const query = composeQuery(input);
      const data = await transport.request(input, count, query, combined);
      if (!count) return { total: data.totalResults, ...(sumSize ? { total_size_bytes: data.totalResults ? logicalBytes(await transport.totalSize(input, query, combined)) : 0, size_basis: 'indexed_logical' } : {}) };
      if (!data.results.length && input.offset < data.totalResults) throw new AgentError('INCOMPLETE_PAGE', 'Repeat the query or narrow its scope to obtain the remaining results.', true);
      const columns = metadata.filter(([field]) => input.fields.includes(field));
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
        rows.push([filename.replaceAll('\\', '/'), row.type, ...columns.map(([field, , format]) => format(field === 'size' ? size : row[field]))]);
      }
      return {
        ...(input.root ? { base: input.root.replaceAll('\\', '/') } : {}),
        total: data.totalResults, next_offset: input.offset + rows.length < data.totalResults ? input.offset + rows.length : null,
        columns: ['path', 'type', ...columns.map(([, column]) => column)], rows,
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
        capabilities: ['paths', 'count', 'browse', 'batch', 'file_size', 'folder_size', 'total_file_size', 'modified_time', 'regex', ...(info.transport === 'ipc' ? ['created_time', 'accessed_time', 'attributes', 'run_count'] : []), ...(info.version?.startsWith('1.5.') ? ['dupe'] : [])], problems: [],
        ...(verbose ? { details: { total_indexed: result.totalResults, backend: info.url ?? 'local IPC', limits: { max_results: this.config.maxResults, output_bytes: this.config.outputBytes } } } : {}) };
    } catch (error) {
      if (signal?.aborted) throw error;
      return { ready: false, transport: null, version: null, instance: null, capabilities: [], problems: [errorResult(error).error] };
    }
  }
}
