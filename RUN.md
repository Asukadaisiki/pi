# 构建与全局更新

以下命令均从仓库根目录 `D:\AutoTestingLearingProject\pi-agent` 执行。项目要求 Node.js `>=22.19.0`。

## 1. 检查与测试

```powershell
npm run check

Push-Location packages/ai
node ../../node_modules/vitest/dist/cli.js --run test/configured-providers.test.ts test/openai-completions-thinking-as-text.test.ts
Pop-Location

Push-Location packages/coding-agent
node ../../node_modules/vitest/dist/cli.js --run test/provider-config.test.ts
Pop-Location
```

`npm run check` 会执行格式检查、类型检查、依赖检查和浏览器 smoke check。不要用完整 `npm test` 代替定向测试。

## 2. 构建当前产物

```powershell
npm run build
```

根目录的 `build` 脚本会依次构建 `tui`、`ai`、`agent`、`storage/sqlite-node`、`coding-agent` 和 `server`，产物位于各包的 `dist` 目录。

## 3. 更新全局 pi

当前全局入口是：

```text
C:\Users\30521\AppData\Roaming\npm\pi.cmd
```

构建不会自动更新全局安装。构建成功后，使用下面的 PowerShell 代码复制运行时产物：

```powershell
$targets = @(
  @{ Source = 'D:\AutoTestingLearingProject\pi-agent\packages\coding-agent\dist'; Destination = 'C:\Users\30521\AppData\Roaming\npm\node_modules\@earendil-works\pi-coding-agent\dist' },
  @{ Source = 'D:\AutoTestingLearingProject\pi-agent\packages\ai\dist'; Destination = 'C:\Users\30521\AppData\Roaming\npm\node_modules\@earendil-works\pi-coding-agent\node_modules\@earendil-works\pi-ai\dist' },
  @{ Source = 'D:\AutoTestingLearingProject\pi-agent\packages\agent\dist'; Destination = 'C:\Users\30521\AppData\Roaming\npm\node_modules\@earendil-works\pi-coding-agent\node_modules\@earendil-works\pi-agent-core\dist' },
  @{ Source = 'D:\AutoTestingLearingProject\pi-agent\packages\tui\dist'; Destination = 'C:\Users\30521\AppData\Roaming\npm\node_modules\@earendil-works\pi-coding-agent\node_modules\@earendil-works\pi-tui\dist' }
)

foreach ($target in $targets) {
  if (-not (Test-Path -LiteralPath $target.Source -PathType Container)) {
    throw "Missing build output: $($target.Source)"
  }
  if (-not (Test-Path -LiteralPath $target.Destination -PathType Container)) {
    throw "Missing global install target: $($target.Destination)"
  }
  Copy-Item -Path (Join-Path $target.Source '*') -Destination $target.Destination -Recurse -Force
}
```

如果 `pi-ai` 有新增文件，必须使用 `-Path` 展开源目录中的 `*`；不要把带通配符的路径传给 `-LiteralPath`。

## 4. 验证全局运行时

```powershell
& 'C:\Users\30521\AppData\Roaming\npm\pi.cmd' --version
& 'C:\Users\30521\AppData\Roaming\npm\pi.cmd' --list-models
& 'C:\Users\30521\AppData\Roaming\npm\pi.cmd' --provider deepseek --model deepseek-v4-flash --no-session -p 'Say hello in one sentence.'
```

最后一条命令应返回模型文本并以退出码 `0` 结束。若只看到旧模型或旧行为，先重新执行全局复制，再检查 `pi.cmd` 指向的目录。

## 5. Provider 配置

配置文件位于：

```text
C:\Users\30521\.pi\agent\config.json
C:\Users\30521\.pi\agent\models.json
```

`config.json` 使用完整的 `url`，不要写 `baseUrl`，也不要把 `curl` 命令写入 URL：

```json
{
  "default": {
    "provider": "deepseek",
    "model": "deepseek-v4-flash"
  },
  "providers": {
    "deepseek": {
      "name": "DeepSeek",
      "vendor": "deepseek",
      "protocol": "openai-completions",
      "url": "https://api.unself.cn/v1/chat/completions",
      "auth": {
        "type": "api-key",
        "token": "YOUR_API_KEY"
      },
      "modelCatalog": "deepseek"
    }
  }
}
```

当前账号额度不足以承受 `deepseek-v4-flash` 模型目录默认的 `384K` 输出上限，因此 `models.json` 中保留了本地覆盖：

```json
{
  "providers": {
    "deepseek": {
      "modelOverrides": {
        "deepseek-v4-flash": {
          "maxTokens": 4096
        }
      }
    }
  }
}
```

额度充足后可以移除该覆盖，恢复模型目录的默认上限。不要把真实 API key 提交到仓库。

## 6. 发布 `asuka.pi`

发布工作流位于 `.github/workflows/publish-asuka-pi.yml`。它支持两种触发方式：

- 推送以 `v` 开头的 Git tag，例如 `v0.0.2`；
- 在 GitHub Actions 页面手动运行 `Publish asuka.pi`。

Tag 只负责触发工作流，实际发布版本以 tag 指向提交中的 `packages/coding-agent/package.json` 的 `version` 为准。不要重复使用已经推送过的 tag，也不要重复发布已经存在的 npm 版本。

Trusted Publisher 的配置必须与下面的值一致：

```text
GitHub repository: Asukadaisiki/pi
Workflow filename: publish-asuka-pi.yml
GitHub environment: npm-publish
Allowed action: npm publish
```

### 推荐发布流程

仓库的 release 脚本会完成版本升级、变更日志更新、检查、构建、测试、提交、创建 tag，并推送 `main` 和 tag。PowerShell 中执行：

```powershell
if (git status --porcelain) { throw 'Working tree must be clean before release.' }

$env:PI_ALLOW_LOCKFILE_CHANGE = '1'
$env:npm_config_min_release_age = '0'
npm run release:patch

Remove-Item Env:PI_ALLOW_LOCKFILE_CHANGE -ErrorAction SilentlyContinue
Remove-Item Env:npm_config_min_release_age -ErrorAction SilentlyContinue
```

`release:patch` 会自动创建并推送 `v<版本号>` tag。tag 推送后，GitHub Actions 会执行安装依赖、构建、检查、测试、打包和 npm 发布。Trusted Publisher 使用 OIDC，不需要在 GitHub Secrets 中保存 npm 发布 token。

如果只修改了代码或文档，不应直接推送 tag；必须先把要发布的版本更新提交到 tag 指向的提交中。发布前确认：

```powershell
Get-Content -Raw -Encoding utf8 packages/coding-agent/package.json | ConvertFrom-Json | Select-Object name, version
```

### 手动触发工作流

不想使用 release 脚本时，可以在新版本提交已经推送到 `main` 后手动触发：

```powershell
gh workflow run publish-asuka-pi.yml --repo Asukadaisiki/pi --ref main -f ref=main
gh run list --repo Asukadaisiki/pi --workflow publish-asuka-pi.yml --limit 1
```

拿到运行编号后查看完整结果：

```powershell
gh run watch <RUN_ID> --repo Asukadaisiki/pi --exit-status
```

发布后验证 npm registry：

```powershell
npm view asuka.pi version dist.tarball repository.url --registry=https://registry.npmjs.org/
```

如果工作流失败，先查看失败步骤和 tag 指向的版本；不要为同一个版本重新创建 tag 或重复执行发布。
