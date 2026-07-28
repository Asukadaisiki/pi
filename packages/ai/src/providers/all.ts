import { MODELS } from "../models.generated.ts";
import { type CreateModelsOptions, createModels, type MutableModels, type Provider } from "../models.ts";
import type { Api, Model } from "../types.ts";
import { createConfiguredProvider } from "./configured.ts";
import type { ConfiguredProviderConfig } from "./configured-types.ts";

/** Providers present in the generated, configured catalog. */
export type BuiltinProvider = keyof typeof MODELS;

type BuiltinModelApi<
	TProvider extends BuiltinProvider,
	TModelId extends keyof (typeof MODELS)[TProvider],
> = (typeof MODELS)[TProvider][TModelId] extends { api: infer TApi } ? (TApi extends Api ? TApi : never) : never;

/** Typed read of the generated built-in catalog. */
export function getBuiltinModel<TProvider extends BuiltinProvider, TModelId extends keyof (typeof MODELS)[TProvider]>(
	provider: TProvider,
	modelId: TModelId,
): Model<BuiltinModelApi<TProvider, TModelId>> {
	const models = MODELS[provider] as Record<string, Model<Api>> | undefined;
	return models?.[modelId as string] as Model<BuiltinModelApi<TProvider, TModelId>>;
}

export function getBuiltinProviders(): BuiltinProvider[] {
	return Object.keys(MODELS) as BuiltinProvider[];
}

export function getBuiltinModels<TProvider extends BuiltinProvider>(
	provider: TProvider,
): Model<BuiltinModelApi<TProvider, keyof (typeof MODELS)[TProvider]>>[] {
	const models = MODELS[provider] as Record<string, Model<Api>> | undefined;
	return models
		? (Object.values(models) as Model<BuiltinModelApi<TProvider, keyof (typeof MODELS)[TProvider]>>[])
		: [];
}

function configuredProvider(config: ConfiguredProviderConfig): Provider {
	const catalogId = config.modelCatalog ?? config.id;
	const catalog = MODELS[catalogId as keyof typeof MODELS] as Record<string, Model<Api>> | undefined;
	if (!catalog) throw new Error(`Configured provider "${config.id}" has no model catalog "${catalogId}"`);
	return createConfiguredProvider(config, Object.values(catalog));
}

/** Build only the providers explicitly declared in config.json. */
export function builtinProviders(configurations?: ReadonlyMap<string, ConfiguredProviderConfig>): Provider[] {
	if (!configurations) return [];
	return [...configurations.values()].map(configuredProvider);
}

/** A `Models` collection with every built-in provider registered. */
export function builtinModels(
	options?: CreateModelsOptions,
	configurations?: ReadonlyMap<string, ConfiguredProviderConfig>,
): MutableModels {
	const models = createModels(options);
	for (const provider of builtinProviders(configurations)) {
		models.setProvider(provider);
	}
	return models;
}
