import type { Model } from "@earendil-works/pi-ai";
import { describe, expect, test } from "vitest";
import { defaultModelPerProvider, parseModelPattern, resolveCliModel } from "../src/core/model-resolver.ts";

const models: Model<"anthropic-messages" | "openai-completions" | "openai-responses">[] = [
	{
		id: "claude-opus-4-8",
		name: "Claude Opus 4.8",
		api: "anthropic-messages",
		provider: "anthropic",
		baseUrl: "https://api.anthropic.com",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
		contextWindow: 1000000,
		maxTokens: 128000,
	},
	{
		id: "deepseek-v4-flash",
		name: "DeepSeek V4 Flash",
		api: "openai-completions",
		provider: "deepseek",
		baseUrl: "https://api.deepseek.com",
		reasoning: true,
		input: ["text"],
		cost: { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0 },
		contextWindow: 1000000,
		maxTokens: 384000,
	},
	{
		id: "gpt-5.5",
		name: "GPT-5.5",
		api: "openai-responses",
		provider: "openai",
		baseUrl: "https://api.openai.com/v1",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 },
		contextWindow: 400000,
		maxTokens: 128000,
	},
];

describe("model resolution", () => {
	test("parses a model with a thinking suffix", () => {
		const result = parseModelPattern("deepseek-v4-flash:high", models);

		expect(result.model?.provider).toBe("deepseek");
		expect(result.model?.id).toBe("deepseek-v4-flash");
		expect(result.thinkingLevel).toBe("high");
		expect(result.warning).toBeUndefined();
	});

	test("resolves provider-prefixed model references", () => {
		const runtime = { getModels: () => models } as unknown as Parameters<typeof resolveCliModel>[0]["modelRuntime"];
		const result = resolveCliModel({
			cliModel: "openai/gpt-5.5",
			modelRuntime: runtime,
		});

		expect(result.error).toBeUndefined();
		expect(result.model?.provider).toBe("openai");
		expect(result.model?.id).toBe("gpt-5.5");
	});

	test("rejects an unavailable provider model", () => {
		const runtime = { getModels: () => models } as unknown as Parameters<typeof resolveCliModel>[0]["modelRuntime"];
		const result = resolveCliModel({
			cliProvider: "deepseek",
			cliModel: "missing-model",
			modelRuntime: runtime,
		});

		expect(result.model).toBeUndefined();
		expect(result.error).toContain("not found");
	});
});

describe("default model selection", () => {
	test("contains exactly the configured provider catalogs", () => {
		expect(defaultModelPerProvider).toEqual({
			anthropic: "claude-opus-4-8",
			deepseek: "deepseek-v4-flash",
			moonshotai: "kimi-k2.6",
			openai: "gpt-5.5",
			zai: "glm-5.1",
		});
	});
});
