import { readFile } from "node:fs/promises";
import { loadConfiguredProviderFile } from "@earendil-works/pi-ai/providers/configured";
import type { ConfiguredProviderFile } from "@earendil-works/pi-ai/providers/configured-types";
import { stripJsonComments } from "../utils/json.ts";

const DEFAULT_PROVIDER_CONFIG = {
	default: {
		provider: "openai",
		model: "gpt-5.5",
		thinking: "high",
	},
	providers: {
		openai: {
			name: "OpenAI",
			vendor: "openai",
			protocol: "openai-responses",
			url: "https://api.openai.com/v1/responses",
			auth: {
				type: "api-key",
				env: ["OPENAI_API_KEY"],
			},
			modelCatalog: "openai",
			defaultModel: "gpt-5.5",
		},
	},
} as const;

const DEFAULT_PROVIDER_FILE = loadConfiguredProviderFile(DEFAULT_PROVIDER_CONFIG);

export interface UserProviderConfig {
	file: ConfiguredProviderFile;
	error?: string;
}

/** Load the user-owned config.json; a missing file uses the OpenAI default in memory. */
export async function loadUserProviderConfig(path: string | null | undefined): Promise<UserProviderConfig> {
	if (path === undefined) return { file: DEFAULT_PROVIDER_FILE };
	if (path === null) return { file: { providers: new Map() } };

	let content: string;
	try {
		content = await readFile(path, "utf-8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { file: DEFAULT_PROVIDER_FILE };
		return {
			file: { providers: new Map() },
			error: `Failed to load config.json: ${error instanceof Error ? error.message : String(error)}\n\nFile: ${path}`,
		};
	}

	try {
		return { file: loadConfiguredProviderFile(JSON.parse(stripJsonComments(content))) };
	} catch (error) {
		return {
			file: { providers: new Map() },
			error: `Invalid config.json: ${error instanceof Error ? error.message : String(error)}\n\nFile: ${path}`,
		};
	}
}
