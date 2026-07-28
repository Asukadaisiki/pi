import type { ProviderAuth } from "../auth/types.ts";
import type { Api, Model, ProviderHeaders } from "../types.ts";

export const CONFIGURED_PROTOCOLS = ["openai-completions", "openai-responses", "anthropic-messages"] as const;

export const CONFIGURED_THINKING_LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;

export type ConfiguredThinkingLevel = (typeof CONFIGURED_THINKING_LEVELS)[number];

export type ConfiguredProtocol = (typeof CONFIGURED_PROTOCOLS)[number];

export interface ConfiguredAuthConfig {
	type: "api-key";
	token?: string;
	env?: readonly string[];
	bearerEnv?: readonly string[];
}

export interface ConfiguredProviderConfig {
	id: string;
	name: string;
	vendor: string;
	protocol: ConfiguredProtocol;
	url: string;
	auth: ConfiguredAuthConfig;
	modelCatalog?: string;
	defaultModel?: string;
	headers?: ProviderHeaders;
}

export interface ConfiguredProviderDefault {
	provider: string;
	model: string;
	thinking?: ConfiguredThinkingLevel;
}

export interface ConfiguredProviderFile {
	default?: ConfiguredProviderDefault;
	providers: ReadonlyMap<string, ConfiguredProviderConfig>;
}

export interface ConfiguredProviderValidator {
	validateConfig(config: ConfiguredProviderConfig): void;
	validatePayload(payload: unknown, model: Model<Api>): unknown;
	createAuth?(config: ConfiguredProviderConfig): ProviderAuth;
}
