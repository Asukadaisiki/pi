import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryCredentialStore } from "../src/auth/credential-store.ts";
import { anthropicOAuth } from "../src/auth/oauth/anthropic.ts";
import { createModels } from "../src/models.ts";
import * as extensionOAuthCompatibility from "../src/oauth.ts";
import { ANTHROPIC_MODELS } from "../src/providers/anthropic.models.ts";
import { createConfiguredProvider, loadConfiguredProviderFile } from "../src/providers/configured.ts";

function configuredAnthropicProvider() {
	const config = loadConfiguredProviderFile({
		providers: {
			anthropic: {
				name: "Claude",
				vendor: "claude",
				protocol: "anthropic-messages",
				baseUrl: "https://api.anthropic.com",
				auth: { type: "api-key", env: ["ANTHROPIC_API_KEY"] },
				modelCatalog: "anthropic",
			},
		},
	});
	return createConfiguredProvider(config.providers.get("anthropic")!, Object.values(ANTHROPIC_MODELS));
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe.sequential("OAuthAuth adapters", () => {
	it("keeps the extension OAuth barrel free of built-in flow implementations", () => {
		expect(extensionOAuthCompatibility).not.toHaveProperty("loginAnthropic");
		expect(extensionOAuthCompatibility).not.toHaveProperty("anthropicOAuth");
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("anthropic toAuth derives the api key from the access token", async () => {
		const auth = await anthropicOAuth.toAuth({ type: "oauth", access: "token", refresh: "r", expires: 0 });
		expect(auth).toEqual({ apiKey: "token" });
	});

	it("anthropic refresh exchanges the refresh token and returns a typed credential", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				jsonResponse({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 }),
			),
		);

		const refreshed = await anthropicOAuth.refresh({ type: "oauth", access: "old", refresh: "old-r", expires: 0 });
		expect(refreshed.type).toBe("oauth");
		expect(refreshed.access).toBe("new-access");
		expect(refreshed.refresh).toBe("new-refresh");
		expect(refreshed.expires).toBeGreaterThan(Date.now());
	});
});

describe("OAuth through Models.getAuth (lazy load chain)", () => {
	it("resolves stored anthropic oauth credentials via the lazy flow import", async () => {
		const credentials = new InMemoryCredentialStore();
		await credentials.modify("anthropic", async () => ({
			type: "oauth",
			access: "oauth-access-token",
			refresh: "r",
			expires: Date.now() + 60_000,
		}));
		const models = createModels({ credentials });
		models.setProvider(configuredAnthropicProvider());

		const model = models.getModels("anthropic")[0];
		const result = await models.getAuth(model.provider);
		expect(result?.auth.apiKey).toBe("oauth-access-token");
		expect(result?.source).toBe("OAuth");
	});
});
