# @earendil-works/pi-ai

`pi-ai` 为 agent 提供统一的 LLM 请求层。用户只需要维护一个外部配置文件，运行时按配置创建 provider，再交给 agent loop 使用。

## 配置位置

默认读取：

```text
C:\\Users\\<用户名>\\.pi\\agent\\config.json
```

不会读取 `packages/ai/src/providers/config.json`。包内只保存协议实现、模型元数据和厂商校验器。

## 配置结构

```json
{
  "default": {
    "provider": "deepseek",
    "model": "deepseek-v4-flash",
    "thinking": "high"
  },
  "providers": {
    "deepseek": {
      "name": "DeepSeek",
      "vendor": "deepseek",
      "protocol": "openai-completions",
      "url": "https://api.deepseek.com/chat/completions",
      "auth": {
        "type": "api-key",
        "token": "YOUR_API_KEY"
      },
      "modelCatalog": "deepseek"
    }
  }
}
```

`url` 是完整请求地址。用户配置的地址会被原样使用，不会再由请求层追加 `/chat/completions`、`/messages` 或 `/responses`。

## 当前支持

厂商校验器：

- `deepseek`
- `openai`
- `claude`
- `kimi`
- `glm`

通用协议：

- `openai-completions`
- `openai-responses`
- `anthropic-messages`

新增厂商时，通常只需要在 `src/providers/validators/` 增加校验器，并在配置中声明对应的 `vendor`、协议、地址和认证方式。

## 目录职责

```text
src/providers/
├── configured.ts          读取配置并构造最终 provider
├── configured-types.ts    配置与校验器类型
├── validators/            厂商级配置和 payload 校验
├── all.ts                 内置模型目录与配置 provider 的组合入口
├── data/                  五个保留模型目录的静态元数据
└── *.models.ts            由脚本生成的类型化模型分片
```

协议实现位于 `src/api/`，通过 lazy wrapper 延迟加载。agent 只接收最终的 `Provider`，不需要知道厂商校验和请求字段转换细节。

## 开发命令

```bash
npm run generate-models
npm run check:model-data
npm run check
```

模型生成脚本只处理当前保留的五个模型目录：
`anthropic`、`deepseek`、`moonshotai`、`openai`、`zai`。
