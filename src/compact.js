import path from 'node:path';
import { AgentError, errorResult, requestsSchema, storageOutputSchema } from './schema.js';

export function toTable(result, input) {
  const base = input.root ? path.win32.normalize(input.root).replaceAll('\\','/') : undefined;
  const columns = ['path','type',...(input.fields.includes('size') ? ['size_bytes'] : []),...(input.fields.includes('date_modified') ? ['modified_utc'] : [])];
  const rows = result.results.map(r => {
    let filename = r.path;
    if (base) {
      filename = path.win32.relative(input.root,r.path);
      if (filename === '..' || filename.startsWith('..\\') || path.win32.isAbsolute(filename)) throw new AgentError('INVALID_RESPONSE','Backend returned a path outside root');
      filename = filename || '.';
    }
    return [filename.replaceAll('\\','/'),r.type,...(input.fields.includes('size') ? [r.size_exact ?? r.size] : []),...(input.fields.includes('date_modified') ? [r.date_modified] : [])];
  });
  return { ...(base ? {base} : {}), total:result.total,next_offset:result.next_offset,columns,rows,
    ...(result.limited_by?.length ? {limited_by:result.limited_by} : {}),...(result.warnings?.length ? {warnings:result.warnings} : {}),
    ...(input.fields.includes('size') ? {size_basis:'indexed_logical'} : {}) };
}
export async function compactSearch(client, arguments_, signal) {
  const { requests } = requestsSchema.parse(arguments_);
  if (requests.reduce((n,r)=>n+Math.min(r.count,client.config.maxResults),0) > client.config.maxResults) throw new AgentError('INVALID_ARGUMENT','Batch aggregate count exceeds the configured result cap');
  const results = new Array(requests.length), budget = Math.floor((client.config.outputBytes - 512) / requests.length);
  let next = 0;
  const worker = async () => {
    while (next < requests.length) {
      const index = next++, request = requests[index];
      try {
        const raw = await client.search(request,signal,client.config.responseBytes);
        const value = request.count === 0 ? {total:raw.total} : toTable(raw,request);
        while (Buffer.byteLength(JSON.stringify(value)) > budget && value.rows?.length) {
          value.rows.pop();
          value.next_offset = request.offset + value.rows.length < value.total ? request.offset + value.rows.length : null;
          value.limited_by = [...new Set([...(value.limited_by || []),'output_bytes'])];
        }
        if (Buffer.byteLength(JSON.stringify(value)) > budget || (value.rows?.length === 0 && raw.returned > 0)) throw new AgentError('OUTPUT_TOO_LARGE','A result exceeds the output budget',false,'Reduce fields or batch size.');
        results[index] = value;
      } catch(error) { if (signal?.aborted) throw error; results[index] = {error:errorResult(error).error}; }
    }
  };
  await Promise.all([worker(),worker()]);
  const output = {results};
  if (Buffer.byteLength(JSON.stringify(output)) > client.config.outputBytes) throw new AgentError('OUTPUT_TOO_LARGE','Batch error/metadata output exceeds the configured budget');
  return output;
}
export function compactStorage(raw) {
  const {ok,complete,caveats,query,...result} = raw;
  if (result.stop_reason === null) delete result.stop_reason;
  return storageOutputSchema.parse(result);
}
