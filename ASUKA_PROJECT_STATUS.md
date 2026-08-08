# asuka.pi 项目状态与 TODO

> 最近核对：2026-08-08
> 核对范围：`v0.82.1..main` 的 Git 提交、当前源码、发布脚本与 Flow 设计文档
> 当前版本：`asuka.pi@0.0.5`，命令名仍为 `pi`

这份文件是 fork 的持续状态入口。它记录已经落地的原生能力、当前限制和后续计划；如果内容与当前代码、Git 历史或实际验证结果冲突，以后者为准，并修正本文。

## 当前结论

- [x] Provider 层已改造成配置驱动架构，并完成精确 endpoint URL 语义。
- [x] fork 已以独立包名 `asuka.pi` 发布，保留 `pi` 命令和 `pi update self` 更新入口。
- [x] Flow Phase 1 已实现：终端内模糊搜索符号、显式选择、调用者/被调用者关系、定义/实现/引用侧关系标注，以及通过 VS Code Bridge 精确跳转。
- [x] Flow Bridge 已随包分发，可用 `pi flow install` 安装、`pi flow doctor` 诊断。
- [ ] Flow 尚未构建稳定的功能调用图，也尚未观察代码改动、生成影响提示或同步 Flow 状态到 LLM。
- [ ] fork 的测试基线和独立发布流程仍需收尾，当前发布链保留了显式跳过已知测试失败的恢复入口。

## 已完成的功能开发

### 1. 配置驱动 Provider 架构

主要提交：`80e9aab`、`00effd4`、`f51e93a`

- 将分散的内置 Provider 实现收敛为 `configured provider` 架构。
- 增加统一的 Provider 配置、运行时解析和协议校验；当前目录覆盖 Anthropic、DeepSeek、Moonshot/Kimi、OpenAI、ZAI/GLM。
- 未知模型在创建运行时阶段直接失败，不再静默落到伪造或不匹配的默认模型。
- Provider 配置中的 `url` 是完整请求地址，不再作为 `baseUrl` 拼接协议路径。
- OpenAI Completions、OpenAI Responses、Anthropic Messages 均通过 exact-URL 适配层使用配置地址。
- coding-agent 的 Provider 解析已接入新的 `ModelRuntime -> AgentSession -> Agent` 执行链。
- 默认 coding tools 收敛为 `read`、`bash`、`edit`、`write`；`grep`、`find`、`ls` 作为可选工具保留。
- 这是一次有意的破坏性收敛：旧的宽泛内置 Provider、OAuth 和部分历史接口不再作为兼容层保留。

### 2. asuka.pi 独立发行

主要提交：`340a3da`、`b1afa41`、`1b8340a`、`b9a6b58`、`1c85506`、`50202f3`、`e07eecf`

- npm 包名改为 `asuka.pi`，终端命令继续使用 `pi`。
- 文档、示例、workspace 依赖和发布产物已同步 fork 包名。
- 建立 tag/manual GitHub Actions 发布入口和 Trusted Publishing 配置。
- 全局 npm 安装产物改为自包含，内部 workspace 依赖随包打入，解决全局安装后缺包问题。
- 已发布版本脉络：
  - `0.0.1`：fork 首次独立发布；
  - `0.0.2`：Provider 改造与 Flow Phase 1；
  - `0.0.3`：自包含全局安装；
  - `0.0.4`：Flow Bridge 安装、诊断、离线 VSIX 与安全修复。
- 当前用户侧更新命令是 `pi update self`；尚未增加 `pi upgrade` 别名。

### 3. Flow Phase 1：语义搜索与精确跳转

主要提交：`23b89d8`

- 增加原生交互命令 `/flow <function-or-symbol-name>`。
- `/flow` 不进入普通用户消息，不启动 Agent turn，也不依赖 LLM 做选择或跳转。
- 查询交给 VS Code 的 workspace symbol provider，Pi 负责规范化、过滤、确定性模糊排序和候选选择。
- 即使只有一个精确结果，也保留显式选择步骤，避免 Agent 擅自决定目标。
- 选择后通过 Bridge 打开精确文件、行列位置。
- 选择后通过 Bridge v3 查询 Call Hierarchy 的 incoming/outgoing calls，并保留 definition、implementation、reference 侧关系；终端使用 `[DEF]`、`[CALL]`、`[CALLER]`、`[IMPL]`、`[REF]` 标签和明确方向文字展示，并保留调用点证据位置。
- 关系 provider 查询会在 workspace symbol 的范围内定位真实符号名，不直接使用可能落在 `async`、`function` 等关键字上的范围起点；这样 `executePreparedToolCall` 等函数才能返回其定义、实现和引用关系。
- 函数流使用固定上下方向标准：`▼` 从选定函数指向 outgoing callee，`▲` 表示 incoming caller 指向选定定义；契约和引用关系只作为侧枝，每个节点直接显示 workspace-relative `path:line:column`。
- 关系结果按类型去重、稳定排序，并对每类结果设置有界数量；这仍是关系检查器，不是完整调用图。
- Bridge 使用版本化本地协议；Windows 走 named pipe，并通过随机 token 和规范化 workspace root 校验连接。
- 找不到兼容 Bridge 时会给出可操作错误，不会退化成 grep 并把文本命中伪装成语义结果。

Phase 1 现在完成了“查找、直接调用关系投影、区分侧关系并跳转”。它仍不是完整运行时管道：尚未递归展开调用图、证明动态分派、观察代码变更或持久化 Flow 状态。

### 4. Flow Bridge 安装、诊断与分发

主要提交：`0af1ffb`、`50202f3`

- 增加 `pi flow install [--code <command>]`，从当前 Pi 安装包内的 VSIX 安装或更新扩展。
- 增加 `pi flow doctor [--code <command>]`，检查 VS Code CLI、扩展版本、workspace discovery 和认证管道连接。
- npm 包与 standalone binary 均携带离线 VSIX；GitHub Release 同时提供 VSIX 和 checksum。
- 修复发布包中的直接/传递依赖告警，并在发布工作流增加审计步骤。
- 已按 Windows 本地 VS Code、全局 npm 安装和实际 workspace 连接路径验证 `0.0.5`。

### 6. Function Flow 文件级修改记录（0.0.5）

本次 Function Flow 变更覆盖以下文件，按职责分组记录：

- `packages/coding-agent/src/core/flow/protocol.ts`：扩展 Flow v3 协议，增加定义、实现、引用、incoming/outgoing call、关系分组和 Bridge `ping` 请求的数据结构与校验。
- `packages/coding-agent/src/core/flow/bridge-client.ts`：增加 `ping` 健康检查、关系查询和响应校验。
- `packages/coding-agent/src/core/flow/index.ts`：导出 Flow 核心接口。
- `packages/coding-agent/src/flow-cli.ts`：让 `pi flow doctor` 使用轻量 Bridge `ping`，不再用语义搜索探测连接。
- `packages/vscode-flow-bridge/src/bridge-server.ts`：处理 `ping`、符号关系和位置打开请求。
- `packages/vscode-flow-bridge/src/semantic-service.ts`：接入 workspace symbol、definition、implementation、reference、Call Hierarchy；增加源码预热、有限重试、关系去重、工作区过滤和位置兼容转换。
- `packages/coding-agent/src/modes/interactive/interactive-mode.ts`：接入 Function Flow 查询、选择、关系加载和交互导航。
- `packages/coding-agent/src/modes/interactive/components/flow-symbol-selector.ts`：显示 `[DEF]` 符号候选及文件行列位置。
- `packages/coding-agent/src/modes/interactive/components/flow-relations-view.ts`：显示上下方向主干、侧枝关系、调用证据位置和空关系状态。
- `packages/coding-agent/test/flow-bridge-client.test.ts`：覆盖 Bridge 握手、`ping`、符号排序、位置打开和关系响应。
- `packages/coding-agent/docs/flow-design.md`：记录 Function Flow 的职责边界、关系语义、上下方向标准和 Phase 1 限制。
- `packages/coding-agent/docs/usage.md`：记录 `/flow` 使用方式、关系标签、导航键和 Bridge 诊断流程。
- `packages/coding-agent/CHANGELOG.md`：记录 Function Flow、Bridge 健康检查和语言服务加载修复。

本次版本同步文件：

- `package.json`、`package-lock.json`：根版本更新为 `0.0.5`。
- `packages/coding-agent/package.json`、`packages/coding-agent/npm-shrinkwrap.json`：`asuka.pi` 更新为 `0.0.5`。
- `packages/vscode-flow-bridge/package.json`：VSIX 版本更新为 `0.0.5`，并同步 `asuka.pi` 依赖。
- `packages/server/package.json`、`packages/evals/package.json`：同步 `asuka.pi@0.0.5` 依赖声明。
- `packages/coding-agent/install-lock/package.json`、`packages/coding-agent/install-lock/package-lock.json`：同步 installer 版本和 tarball 版本。

已知限制：若 VS Code Call Hierarchy 没有返回 incoming call，但 reference provider 返回了调用点，当前界面仍可能将该位置显示为 `[REF]`；这属于关系分类完善项，不代表 Bridge 安装失败。

### 5. Windows 与发布链加固

主要提交：`b9a6b58`、`7587d82`、`0a5e7c9`、`e0bf761`、`645bef2`、`1647091`、`91cf3bf`

- 修复 Windows 下 `find` glob、本地 release/test 隔离和 Git Bash 兼容问题。
- clean build 与 source archive 现在携带 configured-provider 所需数据。
- 保留 `npm pack` 产物路径，避免后续发布步骤找不到 tarball。
- binary packaging 前更新 npm，降低旧 npm 与 Trusted Publishing 的兼容问题。
- 发布脚本提高大体积打包输出的缓冲区，并验证大包内容。
- GitHub Actions 增加显式 `allow_test_failures` 恢复参数；它只用于用户接受已知测试基线问题后的同版本恢复，不代表测试已经通过。
- 当前发行策略暂时收敛为 Windows：`build-binaries.yml` 只构建并上传 `windows-x64`、`windows-arm64`，同时保留源码包、installer 元数据、Flow Bridge VSIX 与 SHA256 校验文件。

## 当前使用入口

```text
pi update self
pi flow install
pi flow doctor
pi
/flow <symbol-query>
```

`/flow` 必须在 Pi 的交互模式中输入；`pi flow install` 和 `pi flow doctor` 是普通终端子命令。安装或升级 VSIX 后需要重新加载 VS Code，再从同一个 workspace 的集成终端运行 Pi。

## TODO

### P0：恢复可信的测试与发布基线

- [ ] 将 Provider 相关旧测试迁移到隔离的 configured-provider fixture 或 faux provider，删除对已移除 OAuth/默认 Provider 行为的陈旧假设。
- [ ] 修复 Windows 下的路径断言、盘符被误识别为 URL scheme、ripgrep 参数式路径等平台差异。
- [ ] 让正常 tag 发布不再依赖 `allow_test_failures=true`；恢复参数只保留给真正的临时 CI 故障。
- [ ] 为 fork 增加独立 `release:asuka` 流程。当前上游 `release.mjs` 假定所有 workspace 包 lockstep 版本，不适合只维护 `asuka.pi` 的 `0.0.x` 版本线。
- [ ] 合并 npm 发布责任。目前 `build-binaries.yml` 与 `publish-asuka-pi.yml` 都包含发布步骤，应确定唯一主流程，并保留幂等的失败恢复方式。
- [ ] 给 `scripts/local-release.mjs` 的大体积 `npm pack --json` 输出增加明确 `maxBuffer` 和回归测试；`scripts/publish.mjs` 已修复，同类本地路径尚未统一。

### P1：Flow Phase 2——Observer Graph

- [ ] 将直接 Call Hierarchy 结果扩展为稳定节点和有类型的边：`call`、`reference`、`implementation`、`contains`，并保留调用点证据。
- [ ] 实现确定性的深度、节点、边和引用预算，处理去重、循环和符号移动后的重新定位。
- [ ] 在终端实现 ASCII spine/branch 管道图，以及 graph、impact、diagnostics 详情页。
- [ ] 监听未保存编辑、保存事件和 VS Code diagnostics；局部刷新受影响节点，不调用 LLM。
- [ ] 区分 `content`、`contract`、`topology`、`diagnostic`、`added`、`removed` 变化。
- [ ] 函数改动后，仅把确有 diagnostic 的节点标为错误；调用者和引用方在没有确定证据时标为 `review required`，不伪造“已报错”。
- [ ] 完成 Phase 2 验收：手动修改函数后，图和影响提示自动更新，并明确区分 confirmed diagnostics 与 review impact。

### P1：Flow Phase 3——会话状态与 LLM 上下文

- [ ] 由 `AgentSession` 持有 `FlowManager`，而不是让 TUI 直接管理业务状态。
- [ ] 增加 `flow_state` checkpoint，使 active Flow 能随 resume、branch、fork、clone 恢复；恢复后先标记 stale，再由 Bridge 刷新。
- [ ] 在每次真实 provider request 前生成有界、确定性的 `<active_flow>` system block。
- [ ] 上下文只同步 seed、范围、变化、diagnostics、review impact 和 topology delta；不发送源码正文、全部引用或 TUI 光标历史。
- [ ] 限制上下文为稳定排序、workspace 相对路径、最多 4 KiB，并覆盖 mid-run edit 后的下一轮请求。
- [ ] 用 faux provider 验证 `/flow` 本身不启动 LLM、Flow 不进入 user/custom message、compaction 不吞掉 Flow 状态。

### P1：Flow Phase 4——受控编辑

- [ ] 在可信 observer graph 之上单独设计编辑范围审批，不与 Phase 2 混做。
- [ ] 为 `edit`、`write` 和可能产生文件修改的 `bash` 增加 mutation preflight。
- [ ] 用户修改节点函数后，自动重新解析下游节点并展示错误、警告、stale 和 review 状态；这条反馈链不依赖 LLM。
- [ ] 允许用户从图中批准文件集合、查看精确证据位置，并明确选择是否扩大修改范围。

### P2：分发与环境扩展

- [ ] 评估是否发布独立 VS Code Marketplace 扩展；当前 bundled VSIX 已可用，不是近期阻塞项。
- [ ] 评估扩展安装后的自动 reload/activation 提示；当前仍需用户重新加载 VS Code。
- [ ] 支持 Remote SSH、WSL、Dev Container 和 browser workspace；Phase 1 当前仅支持本地 VS Code desktop workspace。
- [ ] 升级 GitHub Actions 中仍使用旧 Node runtime 的 artifact actions，移除兼容性告警。
- [ ] 决定是否增加 `pi upgrade` 作为 `pi update self` 的别名；目前文档和运行时统一使用后者。

## Flow 后续设计中的待决项

- [ ] `flow_state` 保存完整有界图，还是紧凑图加 document fingerprints。
- [ ] contract fingerprint 仅使用规范化 hover text，还是在缺少 hover 时增加语言特定 declaration extraction。
- [ ] source/test 排序是否在第一版 observer graph 中开放配置。
- [ ] 未来 direct LSP provider 必须复用 Bridge protocol，还是只需实现 `FlowSemanticProvider` 接口。

分发方式这一项已经部分决策：当前采用随 `asuka.pi` 打包 VSIX并由 `pi flow install` 安装；Marketplace 可以作为后续分发渠道，但不应重新阻塞 Flow 核心设计。

## 维护规则

1. 完成功能、发布版本或改变上述计划时，更新本文件并写明对应 commit。
2. `[x]` 只表示已有代码和相称验证；仅有设计稿、编译通过或未执行的工作不得标为完成。
3. 发布前同时核对本文件、各 package 的 `[Unreleased]` changelog、实际测试结果和 GitHub Actions 状态。
4. Provider 的实际 endpoint、模型和认证以用户本地配置为准，不把密钥或完整私有配置写入本文。
