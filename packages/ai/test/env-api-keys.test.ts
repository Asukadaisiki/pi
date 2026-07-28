import { afterEach, describe, expect, it } from "vitest";
import { findEnvKeys, getEnvApiKey } from "../src/env-api-keys.ts";

const originalValues = new Map(
	[
		"OPENAI_API_KEY",
		"DEEPSEEK_API_KEY",
		"MOONSHOT_API_KEY",
		"ZAI_API_KEY",
		"ANTHROPIC_AUTH_TOKEN",
		"ANTHROPIC_OAUTH_TOKEN",
		"ANTHROPIC_API_KEY",
	].map((name) => [name, process.env[name]]),
);

afterEach(() => {
	for (const [name, value] of originalValues) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
});

describe("environment API keys", () => {
	it("resolves the supported OpenAI-compatible vendors", () => {
		process.env.OPENAI_API_KEY = "openai-token";
		process.env.DEEPSEEK_API_KEY = "deepseek-token";
		process.env.MOONSHOT_API_KEY = "kimi-token";
		process.env.ZAI_API_KEY = "glm-token";

		expect(getEnvApiKey("openai")).toBe("openai-token");
		expect(getEnvApiKey("deepseek")).toBe("deepseek-token");
		expect(getEnvApiKey("moonshotai")).toBe("kimi-token");
		expect(getEnvApiKey("zai")).toBe("glm-token");
		expect(findEnvKeys("openai")).toEqual(["OPENAI_API_KEY"]);
	});

	it("keeps Anthropic bearer token separate from API key lookup", () => {
		process.env.ANTHROPIC_AUTH_TOKEN = "auth-token";
		process.env.ANTHROPIC_OAUTH_TOKEN = "oauth-token";
		process.env.ANTHROPIC_API_KEY = "api-key";

		expect(findEnvKeys("anthropic")).toEqual(["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_OAUTH_TOKEN", "ANTHROPIC_API_KEY"]);
		expect(getEnvApiKey("anthropic")).toBe("oauth-token");
	});

	it("does not resolve removed vendors", () => {
		expect(findEnvKeys("unsupported-vendor")).toBeUndefined();
		expect(getEnvApiKey("unsupported-vendor")).toBeUndefined();
	});
});
