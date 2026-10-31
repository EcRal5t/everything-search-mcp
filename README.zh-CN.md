# everything-mcp-server

[English](README.md)

基于 [voidtools Everything](https://www.voidtools.com/) 的高性能 Windows 本地文件搜索 MCP 服务端。让 AI 助手在数毫秒内检索系统中的数百万个文件与目录。

## 特性

- **毫秒级搜索**：基于 Everything 建立的 NTFS/ReFS 索引，瞬间完成文件名、路径和元数据检索。
- **高 Token 效益输出**：采用紧凑矩阵结构（`base` + `columns` + `rows`），大幅节省大语言模型的上下文 Token。
- **丰富的查询语法**：使用 [Everything 搜索语法](https://www.voidtools.com/support/everything/searching/) 查询文件名、路径与索引元数据，支持通配符、布尔组合、过滤条件及正则表达式。
- **批量查询**：通过 `requests` 数组，每次提交 1–8 项查询。
- **目录与大小统计**：支持目录直接子项浏览、文件夹大小求和以及最大文件排序。
- **双传输通道**：默认通过内置的 `es.exe` 使用本机 IPC 通信，也可用 `EVERYTHING_URL` 指定 HTTP 服务。

## 环境要求

- **操作系统**：Windows (x64, x86, ARM64, ARM)
- **Node.js**：v22.0.0 或更新版本
- **Everything**：已安装并运行 [Everything](https://www.voidtools.com/) 1.4.1+ 或 1.5 Alpha。

## 安装与配置

### OpenAI Codex

在 Codex 配置文件（用户全局 `%USERPROFILE%/.codex/config.toml` 或项目 `.codex/config.toml`）中添加：

```toml
[mcp_servers.everything]
command = "npx"
args = ["-y", "everything-mcp-server"]
```

或通过 Codex CLI 命令行添加：

```powershell
codex mcp add everything -- npx -y everything-mcp-server
```

### OpenCode

在项目的 `opencode.json` 中添加：

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

也可运行 OpenCode 设置向导，填写上面的命令：

```powershell
opencode mcp add
```

### Claude Desktop 及通用 MCP 客户端

在客户端配置（例如 `claude_desktop_config.json`）中添加：

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

## 工具列表

### `everything_search`

搜索文件/目录、浏览文件夹、统计数量及获取元数据。

通过必填的 `requests` 数组提交 1–8 项查询：

```json
{"requests": [{"query": "ext:pdf", "count": 5}]}
```

**每项查询的参数：**

| 参数名 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `query` | string | `""` | Everything 查询语句（如 `*.pdf`、`size:>100mb`、`ext:ts;js`）。 |
| `root` | string | 可选 | 检索根目录绝对路径（如 `D:/Projects`）。省略则检索所有已索引驱动器。 |
| `recursive` | boolean | `true` | 指定 `root` 时生效：`true` 搜索所有子孙项；`false` 仅列出直接子项。 |
| `kind` | string | `"any"` | 筛选类型：`"any"`、`"file"` 或 `"folder"`。 |
| `regex` | boolean | `false` | 将 `query` 作为正则表达式处理。 |
| `count` | number | `20` | 最大返回行数（上限 1000）。设为 `0` 可统计数量；配合 `kind:"file"` 和 `fields:["size"]` 可取得总字节数 `total_size_bytes`。 |
| `offset` | number | `0` | 分页偏移量（基于 0）。 |
| `sort` | string | `"path"` | 排序字段：`path`、`name`、`size`、`extension`、`date_modified`、`date_created`、`date_accessed`、`attributes`、`run_count`。 |
| `ascending` | boolean | `true` | 是否升序（`true` 为升序，`false` 为降序）。 |
| `fields` | string[] | `[]` | 额外获取的元数据列：`size`、`date_modified`、`date_created`、`date_accessed`、`attributes`、`run_count`。 |

IPC 提供上述全部字段与排序。HTTP 支持按名称、路径、大小和修改时间排序，提供大小和修改时间字段，其他元数据取决于所选服务。

**输出格式：**

输出使用节省 Token 的紧凑二维矩阵格式：
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
将 `base` 与 `rows` 中的相对路径拼接即可得到完整路径。
文件与文件夹大小采用 Everything 索引中的逻辑字节数。

### `everything_status`

检查 Everything 连接状态、运行实例、版本及索引就绪情况。

**参数说明：**
- `verbose`（boolean，默认 `false`）：包含已索引条目总数与当前限制配置。

---

## 环境变量

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `EVERYTHING_INSTANCE` | 自动探测 | 自动探测默认实例、`1.5a` 和 `1.5`。自定义实例通过此项指定；`""` 选择默认实例。 |
| `EVERYTHING_URL` | `""` | Everything HTTP 服务地址（例如 `http://127.0.0.1:17603/`）。设置后优先使用 HTTP 通道。 |
| `EVERYTHING_USERNAME` | `""` | HTTP 服务的基础认证用户名。 |
| `EVERYTHING_PASSWORD` | `""` | HTTP 服务的基础认证密码。 |
| `EVERYTHING_MAX_RESULTS` | `1000` | 每项查询及整批查询的总行数上限（1–1000）。 |
| `EVERYTHING_OUTPUT_BYTES` | `16384` | 单次工具调用的输出字节上限预算（4096–65536）。 |
| `EVERYTHING_TIMEOUT_MS` | `15000` | 查询超时毫秒数（100–120000）。 |
| `EVERYTHING_ES_PATH` | 内置路径 | 自定义 `es.exe` 可执行文件路径。 |

---

## 命令行与连接诊断

检查当前环境中的 Everything 连接状态：

```powershell
npx -y everything-mcp-server doctor
```

直接在命令行运行查询：

```powershell
npx -y everything-mcp-server search '{"requests": [{"query": "ext:pdf", "count": 5}]}'
```

---

## 本地开发

```powershell
git clone https://github.com/EcRal5t/everything-search-mcp.git
cd everything-search-mcp
npm install
npm test
```

使用本地源码配置 MCP 客户端：

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

## 许可证

MIT 许可证。内置的 `es.exe` 工具同样由 voidtools 采用 MIT 许可证分发。详情参见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
