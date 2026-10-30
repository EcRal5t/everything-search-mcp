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
  constructor({ executable, instance = '', timeoutMs = 15000, responseBytes = 2097152 }, runner = runProcess) {
    Object.assign(this, { executable, instance, timeoutMs, responseBytes, runner });
  }
  async call(args, signal, timeoutMs = this.timeoutMs) {
    const result = await this.runner(this.executable, ['-argv', '-code-page', '65001', '-instance', this.instance, ...args], { signal, timeoutMs, maxBytes: this.responseBytes });
    if (result.code !== 0) throw new AgentError(result.code === 8 ? 'INSTANCE_NOT_FOUND' : result.code === 6 ? 'ES_VERSION_UNSUPPORTED' : 'IPC_QUERY_FAILED', `ES IPC request failed (exit ${result.code})`, true, 'Run everything-agent doctor; check the instance, index readiness, helper version and process permissions.');
    return result.stdout;
  }
  async getVersion(signal) {
    const value = (await this.call(['-get-everything-version'], signal, 2500)).trim();
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(value) || value.startsWith('0.')) throw new AgentError('INSTANCE_NOT_FOUND', 'Choose an active Everything client instance');
    return value;
  }
  options(input) {
    const args = ['-timeout', String(input.timeout_ms ?? this.timeoutMs), '-count', '4294967295', '-no-pause', '-no-highlight', '-no-hide-empty-search-results', '-no-empty-search-help', '-header', '-no-footer'];
    for (const flag of ['case','whole-word','match-path','diacritics','prefix','suffix','ignore-punctuation','ignore-whitespace']) args.push(`-no-${flag}`);
    args.push('-sort', `${(input.sort ?? 'path').replaceAll('_', '-')}-${input.ascending === false ? 'descending' : 'ascending'}`);
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
    if (!count) return { totalResults, results: [] };
    const fields = [...new Set(['attributes', ...(input.fields ?? [])])];
    const csv = await this.call([...common, '-columns', ['filename', ...fields.map(field => field.replaceAll('_', '-'))].join(';'),
      '-csv','-no-folder-append-path-separator','-no-digit-grouping','-size-format','1','-date-format','2',
      '-viewport-offset',String(input.offset ?? 0),'-viewport-count',String(count),'--',query],signal,input.timeout_ms);
    const [header = [], ...rows] = parseCSV(csv);
    const filename = header.indexOf('Filename'), attributes = header.indexOf('Attributes');
    const indexes = fields.map(field => [field, header.indexOf(field.split('_').map(word => word[0].toUpperCase() + word.slice(1)).join(' '))]);
    if (filename < 0 || indexes.some(([, index]) => index < 0) || rows.length > count) throw new AgentError('INVALID_RESPONSE', 'ES returned unexpected CSV columns or too many rows');
    const results = rows.map(row => {
      if (row.length !== header.length) throw new AgentError('INVALID_RESPONSE', 'ES returned a malformed CSV row');
      const attr = row[attributes];
      if (!/^(?:\d+|[A-Z]*)$/.test(attr)) throw new AgentError('INVALID_RESPONSE', 'ES returned invalid attributes');
      const full = row[filename], folder = /^\d+$/.test(attr) ? Boolean(BigInt(attr) & 16n) : attr.includes('D');
      const drive = /^[a-z]:\\?$/i.test(full);
      return { name: drive ? full.slice(0,2) : path.win32.basename(full), path: drive ? '' : path.win32.dirname(full), type: folder ? 'folder' : 'file', ...Object.fromEntries(indexes.map(([field, index]) => [field, row[index]])) };
    });
    return { totalResults, results };
  }
  async totalSize(input, query, signal) {
    const sum = (await this.call([...this.options(input), '-size-format', '1', '-no-digit-grouping', '-viewport-offset', '0', '-viewport-count', '4294967295', '-get-total-size', '--', query], signal, input.timeout_ms)).trim();
    if (!/^\d+$/.test(sum)) throw new AgentError('INVALID_RESPONSE', 'Expected an integer byte count from ES');
    if (sum === '18446744073709551615') {
      if ((await this.request(input, 0, query, signal)).totalResults === 0) return '0';
      throw new AgentError('METADATA_PENDING', 'Wait for indexed file sizes, then repeat the query.', true);
    }
    return sum;
  }
  async directorySize(root, input, signal) {
    return this.totalSize(input, composeQuery({ root, query: '', recursive: true, kind: 'file', regex: false }), signal);
  }
}
