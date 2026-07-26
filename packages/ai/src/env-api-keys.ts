import type { KnownProvider, ProviderEnv } from "./types.ts";
import { getProviderEnvValue } from "./utils/provider-env.ts";

export const ANTHROPIC_AUTH_TOKEN_ENV = "ANTHROPIC_AUTH_TOKEN";
export const ANTHROPIC_OAUTH_TOKEN_ENV = "ANTHROPIC_OAUTH_TOKEN";
export const ANTHROPIC_API_KEY_ENV = "ANTHROPIC_API_KEY";

function getApiKeyEnvVars(provider: string): readonly string[] | undefined {
	if (provider === "anthropic") {
		return [ANTHROPIC_AUTH_TOKEN_ENV, ANTHROPIC_OAUTH_TOKEN_ENV, ANTHROPIC_API_KEY_ENV];
	}

	const envMap: Partial<Record<KnownProvider, string>> = {
		openai: "OPENAI_API_KEY",
		deepseek: "DEEPSEEK_API_KEY",
		moonshotai: "MOONSHOT_API_KEY",
		zai: "ZAI_API_KEY",
	};
	const envVar = envMap[provider as KnownProvider];
	return envVar ? [envVar] : undefined;
}

/** Find configured environment variables for one of the supported vendors. */
export function findEnvKeys(provider: KnownProvider, env?: ProviderEnv): string[] | undefined;
export function findEnvKeys(provider: string, env?: ProviderEnv): string[] | undefined;
export function findEnvKeys(provider: string, env?: ProviderEnv): string[] | undefined {
	const envVars = getApiKeyEnvVars(provider);
	if (!envVars) return undefined;
	const found = envVars.filter((envVar) => !!getProviderEnvValue(envVar, env));
	return found.length > 0 ? found : undefined;
}

/** Resolve an API key from the environment for the supported vendor set. */
export function getEnvApiKey(provider: KnownProvider, env?: ProviderEnv): string | undefined;
export function getEnvApiKey(provider: string, env?: ProviderEnv): string | undefined;
export function getEnvApiKey(provider: string, env?: ProviderEnv): string | undefined {
	const envKeys = findEnvKeys(provider, env);
	if (!envKeys?.[0]) return undefined;
	const apiKeyEnv = provider === "anthropic" ? envKeys.find((key) => key !== ANTHROPIC_AUTH_TOKEN_ENV) : envKeys[0];
	return apiKeyEnv ? getProviderEnvValue(apiKeyEnv, env) : undefined;
}
