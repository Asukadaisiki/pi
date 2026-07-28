import type { ConfiguredProviderValidator } from "../configured-types.ts";
import {
	assertProtocol,
	validateNumberRange,
	validateOpenAIChatPayload,
	validateThinkingField,
	validateToolNames,
} from "./common.ts";

export const glmValidator: ConfiguredProviderValidator = {
	validateConfig(config) {
		assertProtocol(config, "openai-completions");
	},
	validatePayload(payload) {
		const body = validateOpenAIChatPayload(payload, "GLM");
		validateThinkingField(body, "GLM");
		validateToolNames(body, "GLM");
		validateNumberRange(body, "temperature", 0, 1, "GLM");
		validateNumberRange(body, "top_p", 0.01, 1, "GLM");
		if (body.tool_stream !== undefined && typeof body.tool_stream !== "boolean") {
			throw new Error("GLM payload.tool_stream must be a boolean");
		}
		return body;
	},
};
