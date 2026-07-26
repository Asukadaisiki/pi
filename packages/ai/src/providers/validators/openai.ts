import type { ConfiguredProviderValidator } from "../configured-types.ts";
import { assertProtocol, validateOpenAIResponsesPayload } from "./common.ts";

export const openaiValidator: ConfiguredProviderValidator = {
	validateConfig(config) {
		assertProtocol(config, "openai-responses");
	},
	validatePayload(payload) {
		return validateOpenAIResponsesPayload(payload);
	},
};
