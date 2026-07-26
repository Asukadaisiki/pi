import type { ConfiguredProviderValidator } from "../configured-types.ts";
import { assertProtocol, validateOpenAIChatPayload, validateThinkingField } from "./common.ts";

export const deepseekValidator: ConfiguredProviderValidator = {
	validateConfig(config) {
		assertProtocol(config, "openai-completions");
	},
	validatePayload(payload) {
		const body = validateOpenAIChatPayload(payload, "DeepSeek");
		validateThinkingField(body, "DeepSeek");
		if (body.reasoning_effort !== undefined) {
			const effort = body.reasoning_effort;
			if (typeof effort !== "string" || !["low", "medium", "high", "max", "xhigh"].includes(effort)) {
				throw new Error("DeepSeek payload.reasoning_effort is invalid");
			}
		}
		return body;
	},
};
