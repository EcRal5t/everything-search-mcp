import { AgentError, errorResult, requestsSchema } from './schema.js';

export async function compactSearch(client, arguments_ = {}, signal) {
  const { requests } = requestsSchema.parse(arguments_);
  if (requests.reduce((sum, request) => sum + Math.min(request.count, client.config.maxResults), 0) > client.config.maxResults) {
    throw new AgentError('INVALID_ARGUMENT', 'Batch aggregate count exceeds the configured result cap');
  }
  const results = new Array(requests.length);
  const budget = Math.floor((client.config.outputBytes - 512) / requests.length);
  let next = 0;
  const worker = async () => {
    while (next < requests.length) {
      const index = next++;
      const request = requests[index];
      try {
        const result = await client.search(request, signal);
        const returned = result.rows?.length ?? 0;
        if (result.rows?.length && Buffer.byteLength(JSON.stringify(result)) > budget) {
          const allRows = result.rows;
          const originalLimitedBy = result.limited_by ?? [];
          const candidate = (rowCount) => {
            result.rows = allRows.slice(0, rowCount);
            result.next_offset = request.offset + rowCount < result.total ? request.offset + rowCount : null;
            result.limited_by = [...new Set([...originalLimitedBy, 'output_bytes'])];
            return Buffer.byteLength(JSON.stringify(result)) <= budget;
          };

          let low = 1;
          let high = allRows.length - 1;
          let best = 0;
          while (low <= high) {
            const mid = (low + high) >> 1;
            if (candidate(mid)) {
              best = mid;
              low = mid + 1;
            } else {
              high = mid - 1;
            }
          }
          if (best > 0) {
            candidate(best);
          } else {
            result.rows = [];
            result.next_offset = request.offset < result.total ? request.offset : null;
            result.limited_by = [...new Set([...originalLimitedBy, 'output_bytes'])];
          }
        }
        if (Buffer.byteLength(JSON.stringify(result)) > budget || (returned && !result.rows.length)) {
          throw new AgentError('OUTPUT_TOO_LARGE', 'Reduce fields or batch size to fit the output budget.');
        }
        results[index] = result;
      } catch (error) {
        if (signal?.aborted) throw error;
        results[index] = { error: errorResult(error).error };
      }
    }
  };
  await Promise.all([worker(), worker()]);
  const output = { results };
  if (Buffer.byteLength(JSON.stringify(output)) > client.config.outputBytes) {
    throw new AgentError('OUTPUT_TOO_LARGE', 'Reduce batch size to fit the output budget.');
  }
  return output;
}
