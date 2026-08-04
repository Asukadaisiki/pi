# Providers

Pi uses a configuration-driven provider layer. Provider identity, endpoint, authentication, protocol, and model catalog are declared in `~/.pi/agent/config.json`; coding-agent loads that file through `ModelRuntime` and passes the resulting provider to the agent session.

## Configuration File

The default path is:

```text
~/.pi/agent/config.json
```

On Windows this normally resolves to:

```text
C:\Users\<username>\.pi\agent\config.json
```

When the file is absent, pi creates an in-memory OpenAI configuration using `OPENAI_API_KEY`, the OpenAI Responses endpoint, and `gpt-5.5`. The file is not created automatically.

Minimal equivalent configuration:

```json
{
  "default": {
    "provider": "openai",
    "model": "gpt-5.5",
    "thinking": "high"
  },
  "providers": {
    "openai": {
      "name": "OpenAI",
      "vendor": "openai",
      "protocol": "openai-responses",
      "url": "https://api.openai.com/v1/responses",
      "auth": {
        "type": "api-key",
        "env": ["OPENAI_API_KEY"]
      },
      "modelCatalog": "openai",
      "defaultModel": "gpt-5.5"
    }
  }
}
```

JSON comments are accepted by coding-agent.

## Exact Endpoint URLs

`url` is the complete request endpoint. Pi does not append protocol paths.

Use:

```json
"url": "https://api.deepseek.com/chat/completions"
```

Do not configure only `https://api.deepseek.com` and expect pi to add `/chat/completions`. The same rule applies to `/responses` and `/messages` endpoints.

OpenAI Completions, OpenAI Responses, and Anthropic Messages requests all preserve the configured URL exactly.

## Current Support

Configured providers combine a vendor validator, a shared wire protocol, and a bundled model catalog.

| Service | `vendor` | `protocol` | `modelCatalog` |
|---------|----------|------------|----------------|
| Anthropic Claude | `claude` | `anthropic-messages` | `anthropic` |
| DeepSeek | `deepseek` | `openai-completions` | `deepseek` |
| Moonshot/Kimi | `kimi` | `openai-completions` | `moonshotai` |
| OpenAI | `openai` | `openai-responses` | `openai` |
| ZAI/GLM | `glm` | `openai-completions` | `zai` |

Supported configured protocols:

- `anthropic-messages`
- `openai-completions`
- `openai-responses`

The object key under `providers` is the provider ID shown by `/model` and accepted by `--provider`. It may differ from the vendor and catalog. For example, a proxy can use provider ID `company-deepseek` while reusing the `deepseek` validator and catalog.

```json
{
  "providers": {
    "company-deepseek": {
      "name": "Company DeepSeek Gateway",
      "vendor": "deepseek",
      "protocol": "openai-completions",
      "url": "https://llm.example.com/deepseek/chat/completions",
      "auth": {
        "type": "api-key",
        "env": ["COMPANY_LLM_KEY"]
      },
      "modelCatalog": "deepseek"
    }
  }
}
```

Unknown vendors, unsupported protocols, missing catalogs, and models whose catalog API does not match the configured protocol fail during provider construction. Pi does not silently substitute a different model.

## Provider Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | No | Display name. Defaults to the provider ID. |
| `vendor` | Yes | Vendor validator from the supported table. |
| `protocol` | Yes | Shared wire protocol used for requests. |
| `url` | Yes | Complete request endpoint. |
| `auth` | Yes | API-key authentication declaration. |
| `modelCatalog` | No | Bundled catalog ID. Defaults to the provider ID. |
| `defaultModel` | No | Provider-local default metadata. The top-level `default` controls initial model selection. |
| `headers` | No | Static request headers. String values set headers; `null` suppresses matching defaults. |

The top-level `default` object accepts:

| Field | Required | Description |
|-------|----------|-------------|
| `provider` | Yes | Configured provider ID. |
| `model` | Yes | Model ID from that provider's catalog. |
| `thinking` | No | `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`. |

An explicit model selected in settings or on the command line takes priority over this default.

## Authentication

Configured authentication uses `type: "api-key"` and one or more credential sources:

```json
{
  "auth": {
    "type": "api-key",
    "env": ["PRIMARY_LLM_KEY", "FALLBACK_LLM_KEY"]
  }
}
```

Supported fields:

| Field | Description |
|-------|-------------|
| `token` | Literal token stored in `config.json`. Avoid this when an environment variable or `auth.json` is practical. |
| `env` | Environment variables checked in order for an API key. |
| `bearerEnv` | Claude-only bearer-token variables checked before Claude API-key variables. |

At least one of `token`, `env`, or `bearerEnv` must be present. For the Claude vendor, use `env` for Anthropic API keys and `bearerEnv` for bearer authentication. Claude's custom authentication path does not use an inline `token`.

### Stored API keys

Run `/login` and select a configured provider to store an API key in `~/.pi/agent/auth.json`. Stored credentials are keyed by the configured provider ID:

```json
{
  "openai": {
    "type": "api_key",
    "key": "sk-..."
  },
  "company-deepseek": {
    "type": "api_key",
    "key": "..."
  }
}
```

Use `/logout` to remove the selected provider's stored credential.

### Claude OAuth

The retained `claude` vendor additionally exposes Anthropic Claude Pro/Max OAuth through `/login`. This option is available only when a configured provider uses `vendor: "claude"`; pi no longer ships the former broad set of built-in subscription providers.

### Resolution order

For configured providers, request authentication resolves in this order:

1. `--api-key` or an SDK runtime API-key override;
2. the provider's stored `auth.json` credential;
3. configured authentication sources (`token`, `bearerEnv`, then `env` as applicable to the vendor).

Provider/model headers from `models.json` and extensions are composed after provider authentication. Command-backed values and detailed model overrides are documented in [Custom Models](models.md).

## Complete Examples

### DeepSeek

```json
{
  "providers": {
    "deepseek": {
      "name": "DeepSeek",
      "vendor": "deepseek",
      "protocol": "openai-completions",
      "url": "https://api.deepseek.com/chat/completions",
      "auth": {
        "type": "api-key",
        "env": ["DEEPSEEK_API_KEY"]
      },
      "modelCatalog": "deepseek"
    }
  }
}
```

### Anthropic Claude

```json
{
  "providers": {
    "anthropic": {
      "name": "Claude",
      "vendor": "claude",
      "protocol": "anthropic-messages",
      "url": "https://api.anthropic.com/v1/messages",
      "auth": {
        "type": "api-key",
        "bearerEnv": ["ANTHROPIC_AUTH_TOKEN"],
        "env": ["ANTHROPIC_API_KEY"]
      },
      "modelCatalog": "anthropic"
    }
  }
}
```

### Moonshot/Kimi

```json
{
  "providers": {
    "moonshotai": {
      "name": "Kimi",
      "vendor": "kimi",
      "protocol": "openai-completions",
      "url": "https://api.moonshot.ai/v1/chat/completions",
      "auth": {
        "type": "api-key",
        "env": ["MOONSHOT_API_KEY"]
      },
      "modelCatalog": "moonshotai"
    }
  }
}
```

### ZAI/GLM

```json
{
  "providers": {
    "zai": {
      "name": "GLM",
      "vendor": "glm",
      "protocol": "openai-completions",
      "url": "https://api.z.ai/api/paas/v4/chat/completions",
      "auth": {
        "type": "api-key",
        "env": ["ZAI_API_KEY"]
      },
      "modelCatalog": "zai"
    }
  }
}
```

## `config.json` and `models.json`

The two files have different responsibilities:

- `config.json` declares the configured provider, vendor validation, exact endpoint, authentication, bundled catalog, and initial default.
- `models.json` adds custom models, compatibility flags, headers, pricing, token limits, and provider/model overlays.

Use `config.json` for the normal retained Provider path. Use `models.json` when you need a custom model definition or an overlay on a configured or extension-owned provider. See [Custom Models](models.md).

Providers requiring a new streaming protocol or nonstandard runtime behavior should be implemented as an extension-owned native provider. See [Custom Providers](custom-provider.md).

## Troubleshooting

### `Invalid config.json`

Check that `providers` is an object, every provider has a supported vendor and protocol, `url` is an absolute URL, and `auth` declares at least one credential source.

### `No configured provider validator`

The configured `vendor` is not in the retained vendor set. Reuse an existing validator only when the upstream payload contract actually matches; otherwise add a validator in `packages/ai/src/providers/validators/`.

### `has no model catalog`

`modelCatalog` does not name one of the bundled catalogs: `anthropic`, `deepseek`, `moonshotai`, `openai`, or `zai`.

### `model ... uses ..., expected ...`

The selected catalog's models use a different protocol than the provider entry. Change the configured protocol or use a matching catalog.

### `Provider is not configured`

No usable stored credential, configured token, or declared environment variable was found. Verify the provider ID and the environment variable names in `auth.env`/`auth.bearerEnv`.

### Endpoint returns 404

Confirm that `url` includes the full protocol path. Pi deliberately does not append one.
