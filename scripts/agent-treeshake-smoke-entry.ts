import { Agent } from "@earendil-works/pi-agent-core";
import { createModels } from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { createProvider } from "@earendil-works/pi-ai";
import { ANTHROPIC_MODELS } from "@earendil-works/pi-ai/providers/anthropic.models";

const models = createModels();
models.setProvider(
	createProvider({
		id: "anthropic",
		name: "Claude",
		baseUrl: "https://api.anthropic.com",
		auth: { apiKey: { name: "Anthropic API key", resolve: async () => undefined } },
		models: Object.values(ANTHROPIC_MODELS),
		api: anthropicMessagesApi(),
	}),
);
const model = models.getModel("anthropic", "claude-sonnet-4-5");
if (!model) throw new Error("Anthropic smoke-test model not found");

export const agent = new Agent({
	initialState: { model },
	streamFn: models.streamSimple.bind(models),
});
