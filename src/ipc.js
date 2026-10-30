import path from 'node:path';
import { runProcess } from './process.js';
import { AgentError } from './schema.js';
import { composeQuery } from './everything.js';

export function parseCSV(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (c === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) { if (c === '\r' && text[i+1] === '\n') i++; row.push(cell); if (row.some(Boolean)) rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (quoted) throw new AgentError('INVALID_RESPONSE', 'Unterminated CSV field from ES');
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

export class IpcTransport {
  constructor({ executable, instance = '', version = null, timeoutMs = 15000, responseBytes = 2097152 }, runner = runProcess) {
    Object.assign(this, { executable, instance, version, timeoutMs, responseBytes, runner, local: true });
  }
  async call(args, signal, timeoutMs = this.timeoutMs) {
    const result = await this.runner(this.executable, ['-argv', '-instance', this.instance, ...args], { signal, timeoutMs, maxBytes: this.responseBytes });
    if (result.code !== 0) throw new AgentError(result.code === 8 ? 'INSTANCE_NOT_FOUND' : result.code === 6 ? 'ES_VERSION_UNSUPPORTED' : 'IPC_QUERY_FAILED', `ES IPC request failed (exit ${result.code})`, true, 'Run everything-agent doctor; check the instance, index readiness, helper version and process permissions.');
    return result.stdout;
  }
  async getVersion(signal) {
    const value = (await this.call(['-get-everything-version'], signal, 2500)).trim();
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(value) || value.startsWith('0.')) throw new AgentError('INSTANCE_NOT_FOUND', 'Choose an active Everything client instance');
    this.version = value; return value;
  }
  options(input) {
    const args = ['-timeout', String(input.timeout_ms ?? this.timeoutMs), '-count', '4294967295', '-no-pause', '-no-highlight', '-no-hide-empty-search-results', '-no-empty-search-help', '-header', '-no-footer'];
    for (const [key, flag] of Object.entries({case_sensitive:'case', whole_word:'whole-word', match_path:'match-path', diacritics:'diacritics',prefix:'prefix',suffix:'suffix',ignore_punctuation:'ignore-punctuation',ignore_whitespace:'ignore-whitespace'})) args.push(input[key] ? `-${flag}` : `-no-${flag}`);
    args.push('-sort', `${input.sort === 'date_modified' ? 'date-modified' : input.sort ?? 'path'}-${input.ascending === false ? 'descending' : 'ascending'}`);
    return args;
  }
  async request(input, count, query, signal) {
    const deadline = AbortSignal.timeout(input.timeout_ms ?? this.timeoutMs);
    try { return await this.execute(input,count,query,signal ? AbortSignal.any([signal,deadline]) : deadline); }
    catch(error) { if (deadline.aborted && !signal?.aborted) throw new AgentError('TIMEOUT','IPC query reached its time budget',true,'Narrow the query or increase timeout_ms.'); throw error; }
  }
  async execute(input, count, query, signal) {
    const common = this.options(input);
    const text = await this.call([...common, '-viewport-offset','0','-viewport-count','0','-get-result-count','--',query],signal,input.timeout_ms);
    if (!/^\d+\s*$/.test(text)) throw new AgentError('INVALID_RESPONSE', 'ES returned an invalid count');
    const totalResults = Number(text.trim());
    if (!Number.isSafeInteger(totalResults)) throw new AgentError('INVALID_RESPONSE', 'ES count exceeds the safe integer range');
    if (!count) return { data: { totalResults, results: [] }, query };
    const csv = await this.call([...common, '-columns', 'filename;attributes' + (input.fields?.includes('size') ? ';size' : '') + (input.fields?.includes('date_modified') ? ';date-modified' : ''),
      '-csv','-no-folder-append-path-separator','-no-digit-grouping','-size-format','1','-date-format','2',
      '-viewport-offset',String(input.offset ?? 0),'-viewport-count',String(count),'--',query],signal,input.timeout_ms);
    const [header = [], ...rows] = parseCSV(csv);
    const filename = header.indexOf('Filename'), attributes = header.indexOf('Attributes'), size = header.indexOf('Size'), modified = header.indexOf('Date Modified');
    if (filename < 0 || attributes < 0 || rows.length > count) throw new AgentError('INVALID_RESPONSE', 'ES returned unexpected CSV columns or too many rows');
    const results = rows.map(row => {
      if (row.length !== header.length) throw new AgentError('INVALID_RESPONSE', 'ES returned a malformed CSV row');
      const attr = row[attributes];
      if (!/^(?:\d+|[A-Z]*)$/.test(attr)) throw new AgentError('INVALID_RESPONSE', 'ES returned invalid attributes');
      const full = row[filename], folder = /^\d+$/.test(attr) ? Boolean(BigInt(attr) & 16n) : attr.includes('D');
      const drive = /^[a-z]:\\?$/i.test(full);
      return { name: drive ? full.slice(0,2) : path.win32.basename(full), path: drive ? '' : path.win32.dirname(full), type: folder ? 'folder' : 'file', ...(size >= 0 ? {size:row[size]} : {}), ...(modified >= 0 ? {date_modified:row[modified]} : {}) };
    });
    // SDK2 represents directory size as zero. Sum file sizes for this version's directories.
    if (input.fields?.includes('size') && this.version?.startsWith('1.4.')) {
      for (const row of results) if (row.type === 'folder') {
        const root = row.path ? path.win32.join(row.path,row.name) : row.name + '\\';
        const folderQuery = composeQuery({...input,query:'',root,recursive:true,kind:'file',regex:false});
        const sum = (await this.call([...common,'-size-format','1','-no-digit-grouping','-viewport-offset','0','-viewport-count','4294967295','-get-total-size','--',folderQuery],signal,input.timeout_ms)).trim();
        if (!/^\d+$/.test(sum)) throw new AgentError('INVALID_RESPONSE','ES directory sum needs an integer byte count');
        row.size = sum;
      }
    }
    return { data: {totalResults, results}, query };
  }
}
