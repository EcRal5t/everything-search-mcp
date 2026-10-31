# Everything Search MCP

[简体中文](README.zh-CN.md)

Search Windows files from your AI assistant using [Everything](https://www.voidtools.com/).

Find files across indexed drives by name, path, type, size, or date. Browse folders, compare their sizes, and get counts or total file sizes in a single request. Searches use Everything's existing index, with paginated results and optional metadata.

## Prerequisites

- **OS**: Windows (x64, x86, ARM64, ARM)
- **Node.js**: v22.0.0 or newer
- **Everything**: [Everything](https://www.voidtools.com/) 1.4.1+ or 1.5 Alpha installed and running.

The ES helper is included. The server automatically checks the default Everything instance, `1.5a`, and `1.5` and connects through local IPC.

## Installation & Configuration

On Windows, launch `npx` through `cmd.exe` as shown below. Choose your client, add the configuration, then reload its MCP connections.

[![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/install-mcp?name=everything&config=eyJjb21tYW5kIjoiY21kLmV4ZSIsImFyZ3MiOlsiL2QiLCIvYyIsIm5weCIsIi15IiwiZXZlcnl0aGluZy1tY3Atc2VydmVyIl19)

<details>
<summary>OpenAI Codex</summary>

Add to your Codex configuration file (`%USERPROFILE%/.codex/config.toml` or project-level `.codex/config.toml`):

```toml
[mcp_servers.everything]
command = "cmd.exe"
args = ["/d", "/c", "npx", "-y", "everything-mcp-server"]
```

Or add via Codex CLI:

```powershell
codex mcp add everything -- cmd.exe /d /c npx -y everything-mcp-server
```

</details>

<details>
<summary>OpenCode</summary>

Add to your project's `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "everything": {
      "type": "local",
      "command": ["cmd.exe", "/d", "/c", "npx", "-y", "everything-mcp-server"]
    }
  }
}
```

Or run the OpenCode setup wizard and enter the command above:

```powershell
opencode mcp add
```

</details>

<details>
<summary>Claude Desktop and other MCP clients</summary>

Add to your MCP client configuration (e.g. `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "everything": {
      "command": "cmd.exe",
      "args": ["/d", "/c", "npx", "-y", "everything-mcp-server"]
    }
  }
}
```

VS Code uses `servers` as the top-level key.

</details>

## What to ask

After connecting, ask your assistant to use Everything for tasks such as:

- **Locate a missing file:** “Find quarterly-report PDFs modified last month across my indexed drives.”
- **Investigate large files:** “Show the ten largest log files or archives over 1 GB on C:, including their paths and sizes.”
- **Find project artifacts:** “Find folders named node_modules or target under D:/Projects and tell me how many there are.”
- **Compare folder sizes:** “Compare the sizes of the folders directly inside D:/Projects.”

## Tools

Both tools are read-only.

| Tool | Purpose |
| --- | --- |
| `everything_search` | Find paths, browse folders, count matches, and retrieve sizes or other indexed metadata. |
| `everything_status` | Check the connection, selected Everything instance, and version. |

## Connection settings

Default settings cover common local installations. Use `EVERYTHING_INSTANCE` for a custom instance name. Setting `EVERYTHING_URL` selects an Everything HTTP service; credentials go in `EVERYTHING_USERNAME` and `EVERYTHING_PASSWORD` when needed.

<details>
<summary>All environment variables</summary>

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

</details>

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

## Tool reference

<details>
<summary>Parameters and result format</summary>

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

Results label columns once, followed by row arrays:

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

</details>

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
