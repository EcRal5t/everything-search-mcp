# everything-mcp-server

[简体中文](README.zh-CN.md)

A high-performance Windows file search MCP server powered by [voidtools Everything](https://www.voidtools.com/). Enables AI assistants to search millions of indexed files and directories in milliseconds.

## Features

- **Instant Search**: Millisecond file and path lookups across all indexed NTFS/ReFS volumes.
- **Token-Efficient Compact Output**: Matrix format (`base` + `columns` + `rows`) designed to minimize token usage for LLMs.
- **Flexible Queries**: Search file names, paths, and indexed metadata using [Everything search syntax](https://www.voidtools.com/support/everything/searching/), wildcards, boolean operators, filters, and regular expressions.
- **Batch Queries**: Submit 1–8 queries per call through the `requests` array.
- **Folder & Size Analytics**: Directory size calculation, largest file discovery, and instant item counting.
- **Dual Transport**: Local IPC via bundled `es.exe`, with optional HTTP transport via `EVERYTHING_URL`.

## Prerequisites

- **OS**: Windows (x64, x86, ARM64, ARM)
- **Node.js**: v22.0.0 or newer
- **Everything**: [Everything](https://www.voidtools.com/) 1.4.1+ or 1.5 Alpha installed and running.

## Installation & Configuration

### OpenAI Codex

Add to your Codex configuration file (`%USERPROFILE%/.codex/config.toml` or project-level `.codex/config.toml`):

```toml
[mcp_servers.everything]
command = "npx"
args = ["-y", "everything-mcp-server"]
```

Or add via Codex CLI:

```powershell
codex mcp add everything -- npx -y everything-mcp-server
```

### OpenCode

Add to your project's `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "everything": {
      "type": "local",
      "command": ["npx", "-y", "everything-mcp-server"]
    }
  }
}
```

Or run the OpenCode setup wizard and enter the command above:

```powershell
opencode mcp add
```

### Claude Desktop & Generic MCP Clients

Add to your MCP client configuration (e.g. `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "everything": {
      "command": "npx",
      "args": ["-y", "everything-mcp-server"]
    }
  }
}
```

---

## Tool Reference

### `everything_search`

Search, browse directories, count items, and retrieve indexed metadata.

Pass 1–8 queries in the required `requests` array:

```json
{"requests": [{"query": "ext:pdf", "count": 5}]}
```

**Parameters for each query:**

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `query` | string | `""` | Everything search query (e.g. `*.pdf`, `size:>100mb`, `ext:ts;js`). |
| `root` | string | optional | Directory to search within (e.g. `D:/Projects`). Omitted for global search. |
| `recursive` | boolean | `true` | When `root` is set: `true` searches descendants; `false` lists direct children. |
| `kind` | string | `"any"` | Filter entry type: `"any"`, `"file"`, or `"folder"`. |
| `regex` | boolean | `false` | Treat `query` as a regular expression. |
| `count` | number | `20` | Maximum rows to return (max 1000). Use `0` to count matches; add `kind:"file"` and `fields:["size"]` to get `total_size_bytes`. |
| `offset` | number | `0` | Zero-based pagination offset. |
| `sort` | string | `"path"` | Sort field: `path`, `name`, `size`, `extension`, `date_modified`, `date_created`, `date_accessed`, `attributes`, `run_count`. |
| `ascending` | boolean | `true` | Sort ascending (`true`) or descending (`false`). |
| `fields` | string[] | `[]` | Additional columns: `size`, `date_modified`, `date_created`, `date_accessed`, `attributes`, `run_count`. |

IPC provides all listed fields and sorts. HTTP sorts by name, path, size, or modified time; it provides size and modified-time fields, with other metadata depending on the service.

**Output Format:**

Results use a token-saving matrix structure:
```json
{
  "results": [
    {
      "base": "D:/Projects",
      "total": 42,
      "next_offset": 2,
      "columns": ["path", "type", "size_bytes"],
      "rows": [
        ["src/index.ts", "file", 1024],
        ["package.json", "file", 512]
      ],
      "size_basis": "indexed_logical"
    }
  ]
}
```
Combine `base` with relative paths in `rows` to obtain full file paths.
File and folder sizes use logical byte counts from Everything's index.

### `everything_status`

Check backend connectivity, Everything version, selected instance, and index status.

**Parameters:**
- `verbose` (boolean, default `false`): Include total indexed items and limits.

---

## Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `EVERYTHING_INSTANCE` | auto-detect | Probes the default instance, `1.5a`, and `1.5`. Set this for a custom instance; `""` selects the default instance. |
| `EVERYTHING_URL` | `""` | Everything HTTP server URL (e.g. `http://127.0.0.1:17603/`). When set, uses HTTP transport instead of IPC. |
| `EVERYTHING_USERNAME` | `""` | Basic auth username for HTTP server. |
| `EVERYTHING_PASSWORD` | `""` | Basic auth password for HTTP server. |
| `EVERYTHING_MAX_RESULTS` | `1000` | Row cap for each query and the whole batch (1–1000). |
| `EVERYTHING_OUTPUT_BYTES` | `16384` | Maximum output size budget per tool call (4096–65536). |
| `EVERYTHING_TIMEOUT_MS` | `15000` | Query timeout in milliseconds (100–120000). |
| `EVERYTHING_ES_PATH` | bundled | Custom path to `es.exe`. |

---

## CLI & Diagnostics

Test your Everything installation and backend connection:

```powershell
npx -y everything-mcp-server doctor
```

Run queries from the command line:

```powershell
npx -y everything-mcp-server search '{"requests": [{"query": "ext:pdf", "count": 5}]}'
```

---

## Local Development

```powershell
git clone https://github.com/EcRal5t/everything-search-mcp.git
cd everything-search-mcp
npm install
npm test
```

To configure an MCP client with a local checkout:

```json
{
  "mcpServers": {
    "everything": {
      "command": "node",
      "args": ["D:/path/to/everything-search-mcp/src/cli.js"]
    }
  }
}
```

## License

MIT. Bundled `es.exe` is also MIT licensed by voidtools. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
