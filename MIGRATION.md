# 迁移与 Everything 1.4 验证

发送 `artifacts/everything-agent-transfer.zip`，在目标电脑解压得到 `everything-agent` 目录。迁移包包含 Git 仓库、源码、测试、依赖锁文件和 x64/x86/ARM64/ARM 的 ES 工具。

目标环境使用 Windows、Node.js 22+、npm 和 Everything 1.4.1+。联网执行 `npm ci --ignore-scripts` 后运行 `node src/cli.js doctor`。Git 用于查看提交和记录修复。

在对话工具中把解压后的 `everything-agent` 目录作为工作目录，将下面的文字作为首条用户消息。

## Initial user prompt

```text
当前目录是 Everything MCP 的开发仓库。我从另一台电脑迁移了这个仓库，本机安装的是 Everything 1.4。请在本机完成安装、连接并验证这个 MCP。

先阅读 README.md、MIGRATION.md 和 package.json，检查 Node.js 22+、npm、Git 以及 Everything 客户端的实际版本和运行状态。可以在当前项目安装依赖、启动已安装的 Everything，并配置本机 MCP 连接。保持使用 Everything 1.4，通过包内 ES 的本机 IPC 自动发现实例。

依次执行：
1. 使用 npm ci --ignore-scripts 安装依赖，运行 node src/cli.js doctor，确认选中本机 Everything 实例和 IPC 通道。
2. 完成当前对话工具的 MCP 配置，使用解压目录的实际绝对路径。通过 MCP stdio 完成握手，确认三个工具 everything_search、everything_storage、everything_status 可用。连接需要重新加载时，先通过项目的 scripts/verify-live.js 验证完整 stdio 调用，再给出重载步骤。
3. 在当前项目的临时目录构造少量中文名、空格名和多层文件夹样本。验证搜索、count:0 计数、recursive:false 浏览和分页；验证文件大小、一个及多个文件夹的大小。以样本文件长度之和核对目录的 indexed_logical 字节数，并通过实际 MCP 工具调用确认结果。
4. 检查无效 PCRE、缺失目录和目录汇总超限时的明确错误，以及 allow_partial:true 的扫描范围标识。聚焦这些关键行为即可。

遇到本机兼容性问题请直接在本仓库修复并提交到 Git，延续现有实现并保持代码简洁。文档和提示采用正面表述。项目处于首次对外发布前，MCP 握手标识使用 unreleased，正式版本号在首次发布时确定。

最后告诉我：实际 Everything 版本和实例、使用的通道、MCP 配置位置、关键验证结果、修复内容，以及现在可以怎样直接使用。
```

## 开发命令

```powershell
npm ci --ignore-scripts
node src/cli.js doctor
npm run test:live
npm run check:transfer
```

`npm run pack:transfer` 从已提交的 Git 内容生成迁移 ZIP，包含该提交对应的完整 Git 仓库。目标电脑可以继续使用 Git 提交后续修改。
