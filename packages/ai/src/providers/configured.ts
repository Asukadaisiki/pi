import { anthropicMessagesApi } from "../api/anthropic-messages.lazy.ts";
import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { openAIResponsesApi } from "../api/openai-responses.lazy.ts";
import type { ApiKeyAuth, ProviderAuth } from "../auth/types.ts";
import { createProvider, type Provider } from "../models.ts";
import type { Api, Model, ProviderStreams, StreamOptions } from "../types.ts";
import {
	CONFIGURED_PROTOCOLS,
	CONFIGURED_THINKING_LEVELS,
	type ConfiguredProtocol,
	type ConfiguredProviderConfig,
	type ConfiguredProviderDefault,
	type ConfiguredProviderFile,
	type ConfiguredProviderValidator,
	type ConfiguredThinkingLevel,
} from "./configured-types.ts";
import { claudeValidator } from "./validators/claude.ts";
import { deepseekValidator } from "./validators/deepseek.ts";
import { glmValidator } from "./validators/glm.ts";
import { kimiValidator } from "./validators/kimi.ts";
import { openaiValidator } from "./validators/openai.ts";

const validators: Readonly<Record<string, ConfiguredProviderValidator>> = {
	deepseek: deepseekValidator,
	openai: openaiValidator,
	claude: claudeValidator,
	kimi: kimiValidator,
	glm: glmValidator,
};

function readString(record: Record<string, unknown>, key: string, providerId: string): string {
	const value = record[key];
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`Configured provider "${providerId}".${key} must be a non-empty string`);
	}
	return value;
}

function readOptionalStringArray(
	record: Record<string, unknown>,
	key: string,
	providerId: string,
): readonly string[] | undefined {
	const value = record[key];
	if (value === undefined) return undefined;
	if (
		!Array.isArray(value) ||
		value.length === 0 ||
		value.some((entry) => typeof entry !== "string" || entry.length === 0)
	) {
		throw new Error(`Configured provider "${providerId}".${key} must be a non-empty string array`);
	}
	return value;
}

function readHeaders(value: unknown, providerId: string): Record<string, string | null> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`Configured provider "${providerId}".headers must be an object`);
	}
	const headers: Record<string, string | null> = {};
	for (const [key, headerValue] of Object.entries(value as Record<string, unknown>)) {
		if (headerValue !== null && typeof headerValue !== "string") {
			throw new Error(`Configured provider "${providerId}" header "${key}" must be a string or null`);
		}
		headers[key] = headerValue;
	}
	return headers;
}

function parseConfiguration(id: string, value: unknown): ConfiguredProviderConfig {
	if (!id) throw new Error("Configured provider id must not be empty");
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`Configured provider "${id}" must be an object`);
	}
	const raw = value as Record<string, unknown>;
	const name = raw.name === undefined ? id : readString(raw, "name", id);
	const vendor = readString(raw, "vendor", id);
	const protocol = readString(raw, "protocol", id);
	if (!(CONFIGURED_PROTOCOLS as readonly string[]).includes(protocol)) {
		throw new Error(`Configured provider "${id}" has unsupported protocol "${protocol}"`);
	}
	const url = readString(raw, "url", id);
	try {
		new URL(url);
	} catch {
		throw new Error(`Configured provider "${id}" has an invalid url`);
	}

	const auth = raw.auth;
	if (typeof auth !== "object" || auth === null || Array.isArray(auth)) {
		throw new Error(`Configured provider "${id}" auth must be an object`);
	}
	const rawAuth = auth as Record<string, unknown>;
	if (rawAuth.type !== "api-key") throw new Error(`Configured provider "${id}" only supports api-key auth`);
	const token = rawAuth.token === undefined ? undefined : readString(rawAuth, "token", id);
	const env = readOptionalStringArray(rawAuth, "env", id);
	const bearerEnv = readOptionalStringArray(rawAuth, "bearerEnv", id);
	if (!token && !env?.length && !bearerEnv?.length) {
		throw new Error(`Configured provider "${id}" auth must define token, env, or bearerEnv`);
	}

	const headers = raw.headers === undefined ? undefined : readHeaders(raw.headers, id);
	const defaultModel = raw.defaultModel === undefined ? undefined : readString(raw, "defaultModel", id);
	const modelCatalog = raw.modelCatalog === undefined ? id : readString(raw, "modelCatalog", id);

	return {
		id,
		name,
		vendor,
		protocol: protocol as ConfiguredProtocol,
		url,
		auth: { type: "api-key", token, env, bearerEnv },
		modelCatalog,
		defaultModel,
		headers,
	};
}

function parseDefault(value: unknown): ConfiguredProviderDefault | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("Configured provider default must be an object");
	}
	const raw = value as Record<string, unknown>;
	return {
		provider: readString(raw, "provider", "default"),
		model: readString(raw, "model", "default"),
		thinking:
			raw.thinking === undefined
				? undefined
				: (() => {
						const thinking = readString(raw, "thinking", "default");
						if (!(CONFIGURED_THINKING_LEVELS as readonly string[]).includes(thinking)) {
							throw new Error(`Configured provider default has unsupported thinking level "${thinking}"`);
						}
						return thinking as ConfiguredThinkingLevel;
					})(),
	};
}

/** Parse a user-authored provider config without reading the filesystem. */
export function loadConfiguredProviderFile(value: unknown): ConfiguredProviderFile {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("Configured provider config must be an object");
	}
	const raw = value as Record<string, unknown>;
	const providers = raw.providers;
	if (typeof providers !== "object" || providers === null || Array.isArray(providers)) {
		throw new Error("Configured provider config.providers must be an object");
	}

	const result = new Map<string, ConfiguredProviderConfig>();
	for (const [id, provider] of Object.entries(providers as Record<string, unknown>)) {
		const config = parseConfiguration(id, provider);
		const validator = validators[config.vendor];
		if (!validator) throw new Error(`No configured provider validator for vendor "${config.vendor}"`);
		validator.validateConfig(config);
		result.set(id, config);
	}

	return { default: parseDefault(raw.default), providers: result };
}

export function getConfiguredProviderValidator(vendor: string): ConfiguredProviderValidator | undefined {
	return validators[vendor];
}

function protocolStreams(protocol: ConfiguredProtocol): ProviderStreams {
	switch (protocol) {
		case "openai-completions":
			return openAICompletionsApi();
		case "openai-responses":
			return openAIResponsesApi();
		case "anthropic-messages":
			return anthropicMessagesApi();
	}
}

function configuredModels(config: ConfiguredProviderConfig, models: readonly Model<Api>[]): readonly Model<Api>[] {
	const catalogId = config.modelCatalog ?? config.id;
	const selected = models.filter((model) => model.provider === catalogId || model.provider === config.id);
	if (selected.length === 0) {
		throw new Error(`Configured provider "${config.id}" has no models from catalog "${catalogId}"`);
	}
	for (const model of selected) {
		if (model.api !== config.protocol) {
			throw new Error(
				`Configured provider "${config.id}" model "${model.id}" uses ${model.api}, expected ${config.protocol}`,
			);
		}
	}

	return selected.map((model) => ({
		...model,
		provider: config.id,
		baseUrl: config.url,
		url: config.url,
		headers: model.headers,
	}));
}

function configuredApiKeyAuth(config: ConfiguredProviderConfig): ApiKeyAuth {
	return {
		name: `${config.name} API key`,
		login: async (interaction) => ({
			type: "api_key",
			key: await interaction.prompt({ type: "secret", message: `Enter ${config.name} API key` }),
		}),
		resolve: async ({ ctx, credential }) => {
			if (credential?.key) {
				return { auth: { apiKey: credential.key }, env: credential.env, source: "stored credential" };
			}
			if (config.auth.token) return { auth: { apiKey: config.auth.token }, source: "config.json" };
			for (const envVar of config.auth.env ?? []) {
				const value = await ctx.env(envVar);
				if (value) return { auth: { apiKey: value }, source: envVar };
			}
			return undefined;
		},
	};
}

function wrapOptions<TOptions extends StreamOptions>(
	model: Model<Api>,
	options: TOptions | undefined,
	validator: ConfiguredProviderValidator,
): TOptions {
	return {
		...(options ?? {}),
		onPayload: async (payload: unknown, payloadModel: Model<Api>) => {
			const validatedPayload = validator.validatePayload(payload, payloadModel ?? model);
			return options?.onPayload ? options.onPayload(validatedPayload, payloadModel ?? model) : validatedPayload;
		},
	} as TOptions;
}

/** Build a provider from one externally loaded config entry. */
export function createConfiguredProvider(config: ConfiguredProviderConfig, models: readonly Model<Api>[]): Provider {
	const validator = validators[config.vendor];
	if (!validator) throw new Error(`No configured provider validator for vendor "${config.vendor}"`);
	const providerModels = configuredModels(config, models);
	const customAuth = validator.createAuth?.(config);
	const auth: ProviderAuth = {
		apiKey: customAuth?.apiKey ?? configuredApiKeyAuth(config),
		oauth: customAuth?.oauth,
	};
	const base = createProvider({
		id: config.id,
		name: config.name,
		baseUrl: config.url,
		headers: config.headers,
		auth,
		models: providerModels,
		api: protocolStreams(config.protocol),
	});

	return {
		...base,
		stream: (model, context, options) => base.stream(model, context, wrapOptions(model, options, validator)),
		streamSimple: (model, context, options) =>
			base.streamSimple(model, context, wrapOptions(model, options, validator)),
	};
}

export function isConfiguredProtocol(value: string): value is ConfiguredProtocol {
	return (CONFIGURED_PROTOCOLS as readonly string[]).includes(value);
}
