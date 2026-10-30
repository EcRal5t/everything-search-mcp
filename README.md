# Everything Agent

Everything 文件搜索 MCP，支持 Windows 上的 Everything 1.4.1+ 与 1.5。
默认通过本机 IPC 自动发现客户端和实例，HTTP 用于已配置的服务。三个工具提供路径检索、数量统计、文件夹大小和容量汇总。

## 本地使用

需要 Node.js 22+、已安装且正在运行的 Everything。首次索引完成后即可搜索。

```powershell
npm ci --ignore-scripts
node src/cli.js doctor
npm run install:codex
```

`install:codex` 把本项目注册到 Codex，并安装搜索技能。已有配置保持原值；已有 HTTP 地址的配置可加上 `EVERYTHING_TRANSPORT=auto`，使 IPC 成为首选、该地址成为回退。重新加载 MCP 连接即可使用新接口。
安装器记录当前 Node.js 可执行文件的绝对路径，MCP 使用安装时选定的 Node.js 22+ 运行。

其他 MCP 客户端使用绝对路径：

```json
{"mcpServers":{"everything":{"command":"node","args":["D:/path/to/everything-agent/src/cli.js"]}}}
```

项目内 `.mcp.json` 适合以项目根目录作为工作目录的开发客户端。
当前开发通过源码目录运行。MCP 握手标识为 `unreleased`，正式版本号在首次对外发布时确定。

迁移到另一台 Windows 电脑时，发送 `artifacts/everything-agent-transfer.zip`。ZIP 内包含源码、Git 仓库、依赖锁文件和各架构 ES 工具。解压后在 `everything-agent` 目录执行 `npm ci --ignore-scripts`，即可运行 `node src/cli.js doctor`。
详细操作与首条验证提示词见 [MIGRATION.md](MIGRATION.md)。

## MCP 工具

| 工具 | 用途 |
|---|---|
| `everything_search` | `requests` 中提交 1–8 项查询；默认每项 20 行；`count:0` 统计；`recursive:false` 浏览直接子项 |
| `everything_storage` | 默认返回最大文件；`mode:directories` 汇总目录；支持明确标记的部分汇总 |
| `everything_status` | 查看实例、版本、连接、索引可用状态及修复提示；`verbose:true` 返回更多详情 |

一次比较多个文件夹大小：

```json
{"requests":[{"root":"D:/Projects","recursive":false,"kind":"folder","fields":["size"],"sort":"size","ascending":false,"count":20}]}
```

也可以在同一次调用中，为多个 root 分别提交查询。文件和文件夹都保留大小。
大小统一使用 `size_basis:indexed_logical`，适合索引内的目录比较；实际分配空间与可释放空间由磁盘空间工具计算。Everything 1.4 通过文件大小求和提供目录大小，1.5 使用索引中的目录汇总；求和遵循请求时间预算。

返回数据示例：

```json
{"results":[{"base":"D:/Projects","total":2,"next_offset":null,"columns":["path","type","size_bytes"],"rows":[["app","folder",1048576],["notes.txt","file",256]],"size_basis":"indexed_logical"}]}
```

`base` 与行中的路径组合成绝对路径；`columns` 对应每行的单元格。
全局查询返回绝对路径。`size_bytes` 的超大整数使用十进制字符串；`modified_utc` 使用 UTC ISO 时间；`null` 表示待取得的元数据。
用 `next_offset` 和原查询参数继续翻页。索引实时更新，翻页以当时的索引状态为准。

搜索支持 Everything 路径、名称、扩展名、大小、日期等语法。目录排除示例为 `<ext:ts | ext:js> !path:node_modules !path:.git`。PCRE 模式使用 `regex:true`，由 PCRE2 编译器校验。1.4 与较早的 1.5 使用各自版本的 PCRE 功能；通用表达式适合跨版本使用。
文件内容交给 `rg` 等文本工具。语法资源为 `everything://syntax`。

## 容量汇总

```json
{"root":"D:/Projects","mode":"directories","depth":1,"max_entries":20000}
```

目录汇总默认完成整个查询范围的扫描；超过 `max_entries` 时返回 `SCAN_LIMIT` 和范围调整提示。
`allow_partial:true` 返回 `status:partial`、`ranking_scope:scanned_files`、扫描数量和 `directory_lower_bounds`。这些数值是按路径顺序已扫描文件的下界，排名覆盖已扫描范围。`size_complete` 表示匹配范围和大小元数据均已完成。

`mode:largest_files` 直接使用索引排序，排名覆盖整个匹配范围。

## 自动发现与诊断

默认使用包内 ES 1.1.0.38，包含 x64、x86、ARM64 和 ARM 架构。启动时枚举正在运行的实例；多个实例可通过 `EVERYTHING_INSTANCE` 选择。连接选定后持续使用该索引。

`everything-agent doctor` 输出诊断 JSON；`everything-agent doctor --fix` 可启动已安装的 Everything。安装位置存在多个候选时，用 `EVERYTHING_EXE_PATH` 选择应用。

HTTP 自动发现读取安装目录和用户配置中的启用状态与端口。Everything 1.4 使用内置 HTTP 服务；1.5 使用 HTTP 插件。HTTP 查询使用已运行的服务。配置涉及重载时，可在 Everything 中应用设置。

| 环境变量 | 用途 / 默认 |
|---|---|
| `EVERYTHING_TRANSPORT` | `auto` / `ipc` / `http`；默认自动发现 |
| `EVERYTHING_INSTANCE` | 指定客户端实例，例如 `1.5a`；空字符串选择默认实例 |
| `EVERYTHING_ES_PATH` | 自定义 ES 1.1.0.38+ 路径 |
| `EVERYTHING_EXE_PATH` | doctor 启动的 Everything.exe |
| `EVERYTHING_URL` | 显式 HTTP 地址；默认选择 HTTP，`TRANSPORT=auto` 时作为回退 |
| `EVERYTHING_USERNAME` / `EVERYTHING_PASSWORD` | 显式 HTTP 认证 |
| `EVERYTHING_MAX_RESULTS` | 单页与批量总行数上限，默认 1000 |
| `EVERYTHING_OUTPUT_BYTES` | 单份 JSON 输出预算，默认 16384，范围 4096–65536 |
| `EVERYTHING_RESPONSE_BYTES` | 后端响应预算，默认 2097152 |
| `EVERYTHING_TIMEOUT_MS` | 请求时间预算，默认 15000 |
| `EVERYTHING_OUTPUT_FORMAT` | `structured` 默认提供结构化结果与文本副本；`text` 提供单份 JSON 文本 |

HTTP 可以连接远程服务；root 校验针对后端所在机器。本机连接会校验目录存在性，远程查询的范围由远程索引决定。
MCP 在诊断阶段保持可发现，即使 Everything 正在启动，也能通过 status 获取状态。

## CLI 与验证

CLI 提供 `mcp/doctor/setup/search/storage`。`search` 使用与 MCP 相同的 `requests` 格式，`storage` 使用相同的容量参数。支持 JSON、`--input file.json`、`--stdin`。stdout 输出一个 JSON 对象，错误退出码为 1。

```powershell
npm test
npm run test:live
npm run test:parity
npm run check:transfer
npm run pack:transfer
```

`test:parity` 适用于同时启用 IPC 与 HTTP 的环境。
`test:live` 通过真实 MCP stdio 调用验证中文、空格、多层目录、分页、大小及错误结果；4 个样本文件合计 142 个逻辑字节，验证完成后自动清理样本。IPC 显式使用 UTF-8 代码页，适配 Windows 的不同区域设置。

迁移内容覆盖 `src`、必要脚本、技能、示例、许可证与固定版本 ES。源码仓库中的个人备份和维护脚本由各自目录保留。
第三方来源和哈希见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 与 `vendor/es/manifest.json`。
