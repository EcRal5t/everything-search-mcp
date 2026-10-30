import { AgentError, errorResult, requestsSchema } from './schema.js';

export async function compactSearch(client, arguments_, signal) {
  const { requests } = requestsSchema.parse(arguments_);
  if (requests.reduce((sum, request) => sum + Math.min(request.count, client.config.maxResults), 0) > client.config.maxResults) throw new AgentError('INVALID_ARGUMENT', 'Batch aggregate count exceeds the configured result cap');
  const results = new Array(requests.length), budget = Math.floor((client.config.outputBytes - 512) / requests.length);
  let next = 0;
  const worker = async () => {
    while (next < requests.length) {
      const index = next++, request = requests[index];
      try {
        const result = await client.search(request, signal);
        const returned = result.rows?.length ?? 0;
        while (Buffer.byteLength(JSON.stringify(result)) > budget && result.rows?.length) {
          result.rows.pop();
          result.next_offset = request.offset + result.rows.length < result.total ? request.offset + result.rows.length : null;
          result.limited_by = [...new Set([...(result.limited_by ?? []), 'output_bytes'])];
        }
        if (Buffer.byteLength(JSON.stringify(result)) > budget || (returned && !result.rows.length)) throw new AgentError('OUTPUT_TOO_LARGE', 'Reduce fields or batch size to fit the output budget.');
        results[index] = result;
      } catch (error) {
        if (signal?.aborted) throw error;
        results[index] = { error: errorResult(error).error };
      }
    }
  };
  await Promise.all([worker(), worker()]);
  const output = { results };
  if (Buffer.byteLength(JSON.stringify(output)) > client.config.outputBytes) throw new AgentError('OUTPUT_TOO_LARGE', 'Reduce batch size to fit the output budget.');
  return output;
}
