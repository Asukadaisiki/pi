import { lazyOAuth } from "../../auth/helpers.ts";
import { loadAnthropicOAuth } from "../../auth/oauth/load.ts";
import type { ApiKeyAuth, ProviderAuth } from "../../auth/types.ts";
import type { ConfiguredProviderConfig, ConfiguredProviderValidator } from "../configured-types.ts";
import { asRecord, assertProtocol, requiredArray, requiredString } from "./common.ts";

function createClaudeApiKeyAuth(config: ConfiguredProviderConfig): ApiKeyAuth {
	return {
		name: "Anthropic API key",
		login: async (interaction) => ({
			type: "api_key",
			key: await interaction.prompt({ type: "secret", message: "Enter Anthropic API key" }),
		}),
		resolve: async ({ ctx, credential }) => {
			if (credential?.key) {
				return { auth: { apiKey: credential.key }, env: credential.env, source: "stored credential" };
			}

			for (const envVar of config.auth.bearerEnv ?? []) {
				const token = await ctx.env(envVar);
				if (token) {
					return { auth: { headers: { Authorization: `Bearer ${token}` } }, source: envVar };
				}
			}

			for (const envVar of config.auth.env ?? []) {
				const token = await ctx.env(envVar);
				if (token) return { auth: { apiKey: token }, source: envVar };
			}
			return undefined;
		},
	};
}

export const claudeValidator: ConfiguredProviderValidator = {
	validateConfig(config) {
		assertProtocol(config, "anthropic-messages");
	},
	validatePayload(payload) {
		const body = asRecord(payload, "Claude payload");
		requiredString(body, "model", "Claude payload");
		requiredArray(body, "messages", "Claude payload");
		const maxTokens = body.max_tokens;
		if (typeof maxTokens !== "number" || !Number.isInteger(maxTokens) || maxTokens < 0) {
			throw new Error("Claude payload.max_tokens must be a non-negative integer");
		}
		return body;
	},
	createAuth(config) {
		const auth: ProviderAuth = {
			apiKey: createClaudeApiKeyAuth(config),
			oauth: lazyOAuth({ name: "Anthropic (Claude Pro/Max)", load: loadAnthropicOAuth }),
		};
		return auth;
	},
};
