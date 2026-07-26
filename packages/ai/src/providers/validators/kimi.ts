import type { ConfiguredProviderValidator } from "../configured-types.ts";
import { assertProtocol, validateOpenAIChatPayload, validateThinkingField, validateToolNames } from "./common.ts";

export const kimiValidator: ConfiguredProviderValidator = {
	validateConfig(config) {
		assertProtocol(config, "openai-completions");
	},
	validatePayload(payload) {
		const body = validateOpenAIChatPayload(payload, "Kimi");
		validateThinkingField(body, "Kimi");
		validateToolNames(body, "Kimi");
		if (body.prompt_cache_key !== undefined && typeof body.prompt_cache_key !== "string") {
			throw new Error("Kimi payload.prompt_cache_key must be a string");
		}
		return body;
	},
};
