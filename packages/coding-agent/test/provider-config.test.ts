import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";
import { loadUserProviderConfig } from "../src/core/provider-config.ts";

describe("user provider config", () => {
	it("uses OpenAI ChatGPT as the default when config.json is absent", async () => {
		const result = await loadUserProviderConfig(join(tmpdir(), "pi-agent-config-that-does-not-exist", "config.json"));

		expect(result.error).toBeUndefined();
		expect(result.file.default).toEqual({ provider: "openai", model: "gpt-5.5", thinking: "high" });
		expect(result.file.providers.get("openai")).toMatchObject({
			vendor: "openai",
			protocol: "openai-responses",
			url: "https://api.openai.com/v1/responses",
			defaultModel: "gpt-5.5",
		});
	});

	it("treats an explicitly disabled config path as empty", async () => {
		const result = await loadUserProviderConfig(null);

		expect(result.error).toBeUndefined();
		expect(result.file.default).toBeUndefined();
		expect(result.file.providers.size).toBe(0);
	});

	it("passes the user config layer into ModelRuntime", async () => {
		const runtime = await ModelRuntime.create({
			credentials: AuthStorage.inMemory(),
			modelsPath: null,
			providerConfigPath: join(tmpdir(), "pi-agent-config-that-does-not-exist", "config.json"),
			allowModelNetwork: false,
		});

		expect(runtime.getDefaultModelReference()).toEqual({ provider: "openai", model: "gpt-5.5", thinking: "high" });
		expect(runtime.getModel("openai", "gpt-5.5")).toBeDefined();
	});
});
