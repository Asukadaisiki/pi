---
name: add-llm-provider
description: Add or extend an LLM provider in the config-driven packages/ai architecture. Distinguishes config-only endpoints, new vendor validators and catalogs, and genuinely new wire protocols.
---

# Adding an LLM Provider

Pi separates provider identity, vendor validation, model catalogs, and wire protocols. Determine which layer is changing before editing code.

## 1. Classify the Change

### A. New endpoint using an existing vendor, protocol, and model catalog

No repository change is required. Add an entry to `~/.pi/agent/config.json` with:

- an arbitrary provider ID under `providers`;
- one of the supported `vendor` validators;
- one of the supported `protocol` values;
- `url` set to the complete request endpoint;
- `auth` describing the token or environment variables;
- `modelCatalog` naming one of the bundled catalogs.

Do not append `/chat/completions`, `/responses`, or `/messages` in code. Configured-provider `url` values are exact endpoints and are sent unchanged.

### B. New vendor or bundled model catalog using an existing protocol

This is the normal repository-level provider addition. Add a vendor validator and, when the provider needs its own models, a bundled catalog. Do not create a provider-specific streaming implementation.

### C. New wire protocol

Only this case needs a new module under `packages/ai/src/api/`, new stream option types, payload/response conversion, and event parsing. Keep this work separate from vendor validation and catalog metadata.

## 2. Configured Provider Surface

The canonical files are:

- `packages/ai/src/providers/configured-types.ts` for config, validator, protocol, and thinking-level types;
- `packages/ai/src/providers/configured.ts` for parsing, validator registration, auth, protocol dispatch, and provider construction;
- `packages/ai/src/providers/validators/` for vendor-specific config and payload validation;
- `packages/ai/src/providers/all.ts` for combining explicit config entries with bundled model catalogs;
- `packages/coding-agent/src/core/provider-config.ts` for loading `~/.pi/agent/config.json`;
- `packages/coding-agent/src/core/model-runtime.ts` for wiring providers into the agent runtime.

For a new vendor that reuses an existing protocol:

1. Add a validator under `packages/ai/src/providers/validators/`.
2. Register it in the `validators` map in `configured.ts`.
3. Validate the required protocol and vendor-specific payload fields.
4. Implement `createAuth` only when the generic configured API-key flow is insufficient.

Authentication variables belong in the provider's `auth.env` or `auth.bearerEnv` configuration. Do not add a global hard-coded environment-variable mapping unless a retained compatibility API explicitly requires it.

## 3. Bundled Model Catalog

Bundled catalogs are static JSON data grouped by API:

```text
packages/ai/src/providers/data/<provider>.json
```

When adding a catalog:

1. Add the provider ID to `providerIds` in `packages/ai/scripts/generate-models.ts`.
2. Add the API-grouped JSON model data.
3. Update `KnownProvider` in `packages/ai/src/types.ts` when the catalog should be part of the typed retained provider set.
4. Run `npm run generate-models`; never edit `packages/ai/src/models.generated.ts` directly.
5. Update `defaultModelPerProvider` only when adding a new `KnownProvider` that needs a coding-agent fallback. User selection still takes priority from `config.json.default`.

The generator reads checked-in catalog JSON. It does not fetch arbitrary provider sources.

## 4. New Protocol Only

For a genuinely new wire protocol:

1. Add the protocol to `KnownApi`/`ApiOptionsMap` in `packages/ai/src/types.ts`.
2. Add its implementation and lazy wrapper under `packages/ai/src/api/`.
3. Add the protocol to `CONFIGURED_PROTOCOLS` in `configured-types.ts`.
4. Route it from `protocolStreams()` in `configured.ts`.
5. Add only the package exports and root type exports required by the new API surface. Existing `./api/*` and `./providers/*` package exports are wildcard exports.
6. Preserve the `AssistantMessageEventStream` contract and exact-endpoint behavior.

Do not create or restore `providers/register-builtins.ts`; configured providers are constructed from explicit config entries.

## 5. Tests

For a vendor or config change, update focused coverage in:

- `packages/ai/test/configured-providers.test.ts` for config parsing, auth, provider construction, and vendor payload validation;
- `packages/ai/test/model-data-validation.test.ts` for catalog structure and generated-data integrity;
- protocol-specific tests such as `openai-completions-thinking-as-text.test.ts` when request behavior changes;
- coding-agent `ModelRuntime` or session tests when runtime resolution changes.

Use a faux provider or isolated configured-provider fixture. Do not make real paid provider requests in regression tests.

Run modified test files from their package root, then run `npm run check` from the repository root. Do not run the full Vitest suite or `npm test` unless explicitly requested.

## 6. Documentation and Changelog

Update the surfaces affected by the change:

- `packages/ai/README.md` for supported validators, protocols, config shape, and catalog layout;
- `packages/coding-agent/docs/providers.md` for user configuration and authentication;
- `packages/coding-agent/docs/models.md` when `models.json` behavior changes;
- the relevant package `CHANGELOG.md` under `## [Unreleased]`.

Document `url` as a complete request endpoint. Do not describe configured providers as separately registered built-ins or imply that removed OAuth/provider implementations still ship.
