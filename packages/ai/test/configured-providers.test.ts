import { describe, expect, it } from "vitest";
import type { AuthContext } from "../src/auth/types.ts";
import { createModels } from "../src/models.ts";
import { createConfiguredProvider, loadConfiguredProviderFile } from "../src/providers/configured.ts";
import { claudeValidator } from "../src/providers/validators/claude.ts";
import { deepseekValidator } from "../src/providers/validators/deepseek.ts";
import { glmValidator } from "../src/providers/validators/glm.ts";
import { kimiValidator } from "../src/providers/validators/kimi.ts";
import { openaiValidator } from "../src/providers/validators/openai.ts";
import type { Api, Model } from "../src/types.ts";

function fakeAuthContext(env: Record<string, string>): AuthContext {
	return {
		env: async (name) => env[name],
		fileExists: async () => false,
	};
}

function testModel(provider: string, api: Api): Model<Api> {
	return {
		id: "test-model",
		name: "Test model",
		api,
		provider,
		baseUrl: "https://old.example.test/v1",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 10000,
		maxTokens: 1000,
	};
}

describe("configured providers", () => {
	const configFile = loadConfiguredProviderFile({
		default: { provider: "openai", model: "gpt-5.5" },
		providers: {
			deepseek: {
				name: "DeepSeek",
				vendor: "deepseek",
				protocol: "openai-completions",
				url: "https://api.deepseek.com/chat/completions",
				auth: { type: "api-key", env: ["DEEPSEEK_API_KEY"] },
				modelCatalog: "deepseek",
			},
			openai: {
				name: "OpenAI",
				vendor: "openai",
				protocol: "openai-responses",
				url: "https://api.openai.com/v1/responses",
				auth: { type: "api-key", env: ["OPENAI_API_KEY"] },
				modelCatalog: "openai",
				defaultModel: "gpt-5.5",
			},
			anthropic: {
				name: "Claude",
				vendor: "claude",
				protocol: "anthropic-messages",
				url: "https://api.anthropic.com/v1/messages",
				auth: {
					type: "api-key",
					env: ["ANTHROPIC_OAUTH_TOKEN", "ANTHROPIC_API_KEY"],
					bearerEnv: ["ANTHROPIC_AUTH_TOKEN"],
				},
				modelCatalog: "anthropic",
			},
			moonshotai: {
				name: "Kimi",
				vendor: "kimi",
				protocol: "openai-completions",
				url: "https://api.moonshot.ai/v1/chat/completions",
				auth: { type: "api-key", env: ["MOONSHOT_API_KEY"] },
				modelCatalog: "moonshotai",
			},
			zai: {
				name: "GLM",
				vendor: "glm",
				protocol: "openai-completions",
				url: "https://api.z.ai/api/paas/v4/chat/completions",
				auth: { type: "api-key", env: ["ZAI_API_KEY"] },
				modelCatalog: "zai",
			},
		},
	});

	it("loads user-authored vendor entries from one config file", () => {
		expect([...configFile.providers.values()].map((config) => config.vendor)).toEqual([
			"deepseek",
			"openai",
			"claude",
			"kimi",
			"glm",
		]);
		expect(configFile.default).toEqual({ provider: "openai", model: "gpt-5.5" });
		expect(configFile.providers.get("openai")).toMatchObject({
			protocol: "openai-responses",
			url: "https://api.openai.com/v1/responses",
			defaultModel: "gpt-5.5",
		});
	});

	it("creates a provider from config and keeps protocol loading lazy", async () => {
		const provider = createConfiguredProvider(configFile.providers.get("deepseek")!, [
			testModel("deepseek", "openai-completions"),
		]);
		const model = provider.getModels()[0];

		expect(provider.id).toBe("deepseek");
		expect(model.url).toBe("https://api.deepseek.com/chat/completions");

		const models = createModels({ authContext: fakeAuthContext({ DEEPSEEK_API_KEY: "deepseek-key" }) });
		models.setProvider(provider);
		expect((await models.getAuth("deepseek"))?.auth.apiKey).toBe("deepseek-key");
	});

	it("preserves Claude bearer-token precedence from config", async () => {
		const provider = createConfiguredProvider(configFile.providers.get("anthropic")!, [
			testModel("anthropic", "anthropic-messages"),
		]);
		const models = createModels({
			authContext: fakeAuthContext({
				ANTHROPIC_AUTH_TOKEN: "auth-token",
				ANTHROPIC_OAUTH_TOKEN: "oauth-token",
				ANTHROPIC_API_KEY: "api-key",
			}),
		});
		models.setProvider(provider);

		expect(await models.getAuth("anthropic")).toMatchObject({
			auth: { headers: { Authorization: "Bearer auth-token" } },
			source: "ANTHROPIC_AUTH_TOKEN",
		});
	});
});

describe("configured vendor validators", () => {
	it("accepts the supported DeepSeek thinking fields", () => {
		expect(
			deepseekValidator.validatePayload(
				{
					model: "deepseek-v4-pro",
					messages: [{ role: "user", content: "hi" }],
					thinking: { type: "enabled" },
					reasoning_effort: "high",
				},
				testModel("deepseek", "openai-completions"),
			),
		).toBeTruthy();
		expect(() =>
			deepseekValidator.validatePayload(
				{ model: "deepseek-v4-pro", messages: [{ role: "user", content: "hi" }], thinking: { type: "unknown" } },
				testModel("deepseek", "openai-completions"),
			),
		).toThrow();
	});

	it("checks the protocol-specific body requirements", () => {
		expect(() =>
			openaiValidator.validatePayload({ model: "gpt-5.4" }, testModel("openai", "openai-responses")),
		).toThrow("input");
		expect(() =>
			claudeValidator.validatePayload(
				{ model: "claude-sonnet-4-5", messages: [] },
				testModel("anthropic", "anthropic-messages"),
			),
		).toThrow("messages");
		expect(() =>
			kimiValidator.validatePayload(
				{ model: "kimi-k2.6", messages: [{ role: "user", content: "hi" }], prompt_cache_key: 1 },
				testModel("moonshotai", "openai-completions"),
			),
		).toThrow("prompt_cache_key");
		expect(() =>
			glmValidator.validatePayload(
				{ model: "glm-5.1", messages: [{ role: "user", content: "hi" }], temperature: 2 },
				testModel("zai", "openai-completions"),
			),
		).toThrow("temperature");
	});
});
