# Everything Search MCP

[English](README.md)

让 AI 助手通过 [Everything](https://www.voidtools.com/) 查找 Windows 上的文件。

按名称、路径、类型、大小或日期搜索各个已索引的驱动器，也能浏览目录、比较文件夹大小，或一次取得匹配数量和文件总大小。搜索使用 Everything 已有的索引，结果支持分页，并可按需附带文件信息。

## 环境要求

- **操作系统**：Windows (x64, x86, ARM64, ARM)
- **Node.js**：v22.0.0 或更新版本
- **Everything**：已安装并运行 [Everything](https://www.voidtools.com/) 1.4.1+ 或 1.5 Alpha。

包内已附带 ES 工具。服务会自动探测默认实例、`1.5a` 和 `1.5`，通过本机 IPC 连接。

## 安装与配置

Windows 下按以下示例，通过 `cmd.exe` 启动 `npx`。选择对应客户端，添加配置后重新加载 MCP 连接。（DeepSeek Harness 例外：它直接 spawn 命令，用裸 `npx` 即可，见下方小节。）

[![安装到 Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/install-mcp?name=everything&config=eyJjb21tYW5kIjoiY21kLmV4ZSIsImFyZ3MiOlsiL2QiLCIvYyIsIm5weCIsIi15IiwiZXZlcnl0aGluZy1tY3Atc2VydmVyIl19)

<details>
<summary>OpenAI Codex</summary>

在 Codex 配置文件（用户全局 `%USERPROFILE%/.codex/config.toml` 或项目 `.codex/config.toml`）中添加：

```toml
[mcp_servers.everything]
command = "cmd.exe"
args = ["/d", "/c", "npx", "-y", "everything-mcp-server"]
```

或通过 Codex CLI 命令行添加：

```powershell
codex mcp add everything -- cmd.exe /d /c npx -y everything-mcp-server
```

</details>

<details>
<summary>OpenCode</summary>

在项目的 `opencode.json` 中添加：

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

也可运行 OpenCode 设置向导，填写上面的命令：

```powershell
opencode mcp add
```

</details>

<details>
<summary>DeepSeek Harness</summary>

安装配置包（通过 DSH 内置的 MCP 客户端挂载，不改动其他东西）：

```powershell
dsh plugin --profile <profile> add github:EcRal5t/everything-search-mcp#path:/plugins/dsh-everything-mcp
```

重启该 profile 后，工具以 `mcp__everything__everything_search` 和 `mcp__everything__everything_status` 出现。也可以手工在 profile 的 `cordis.patch.yml` 里加：

```yaml
- insert:
    - id: mcp-everything
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: everything
        transport: stdio
        command: npx
        args: ['-y', 'everything-mcp-server']
```

DSH 直接 spawn 命令，不需要 `cmd.exe` 包装。配置包本身见 [`plugins/dsh-everything-mcp`](plugins/dsh-everything-mcp)。

</details>

<details>
<summary>Claude Desktop 及其他 MCP 客户端</summary>

在客户端配置（例如 `claude_desktop_config.json`）中添加：

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

VS Code 的顶层字段使用 `servers`。

</details>

## 使用示例

连接后，可以让助手使用 Everything 完成这些任务：

- **找回文件**：“在各个已索引的驱动器上，找出上个月修改过、文件名包含 quarterly-report 的 PDF。”
- **排查大文件**：“列出 C 盘超过 1 GB 的日志和压缩包中最大的十个，附上路径和大小。”
- **查找工程产物**：“查找 D:/Projects 下名为 node_modules 或 target 的文件夹，并统计数量。”
- **比较目录大小**：“比较 D:/Projects 下各个直接子文件夹的大小。”

## 工具

两个工具均为只读。

| 工具 | 用途 |
| --- | --- |
| `everything_search` | 查找路径、浏览目录、统计数量，以及取得大小或其他索引元数据。 |
| `everything_status` | 查看连接状态、所选 Everything 实例和版本。 |

## 连接设置

常见本机安装使用默认设置即可。自定义实例通过 `EVERYTHING_INSTANCE` 指定；设置 `EVERYTHING_URL` 后会连接指定的 Everything HTTP 服务。需要认证时，使用 `EVERYTHING_USERNAME` 和 `EVERYTHING_PASSWORD` 提供账号密码。

<details>
<summary>全部环境变量</summary>

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

</details>

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

## 工具参考

<details>
<summary>参数与结果格式</summary>

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

输出先列出列名，再逐行返回数据：

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

</details>

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
