import type { ConfiguredProtocol, ConfiguredProviderConfig } from "../configured-types.ts";

export function asRecord(value: unknown, label: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${label} must be an object`);
	}
	return value as Record<string, unknown>;
}

export function requiredString(record: Record<string, unknown>, key: string, label: string): string {
	const value = record[key];
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`${label}.${key} must be a non-empty string`);
	}
	return value;
}

export function requiredArray(record: Record<string, unknown>, key: string, label: string): unknown[] {
	const value = record[key];
	if (!Array.isArray(value) || value.length === 0) {
		throw new Error(`${label}.${key} must be a non-empty array`);
	}
	return value;
}

export function assertProtocol(config: ConfiguredProviderConfig, protocol: ConfiguredProtocol): void {
	if (config.protocol !== protocol) {
		throw new Error(`${config.vendor} requires protocol ${protocol}, received ${config.protocol}`);
	}
}

export function validateOpenAIChatPayload(payload: unknown, vendor: string): Record<string, unknown> {
	const body = asRecord(payload, `${vendor} payload`);
	requiredString(body, "model", vendor);
	requiredArray(body, "messages", vendor);
	return body;
}

export function validateOpenAIResponsesPayload(payload: unknown): Record<string, unknown> {
	const body = asRecord(payload, "OpenAI Responses payload");
	requiredString(body, "model", "OpenAI Responses payload");
	if (typeof body.input !== "string" && !Array.isArray(body.input)) {
		throw new Error("OpenAI Responses payload.input must be a string or array");
	}
	return body;
}

export function validateThinkingField(body: Record<string, unknown>, vendor: string): void {
	if (body.thinking === undefined) return;
	const thinking = asRecord(body.thinking, `${vendor} payload.thinking`);
	const type = requiredString(thinking, "type", `${vendor} payload.thinking`);
	if (type !== "enabled" && type !== "disabled") {
		throw new Error(`${vendor} payload.thinking.type must be enabled or disabled`);
	}
}

export function validateToolNames(body: Record<string, unknown>, vendor: string): void {
	if (body.tools === undefined) return;
	if (!Array.isArray(body.tools)) {
		throw new Error(`${vendor} payload.tools must be an array`);
	}

	for (const [index, toolValue] of body.tools.entries()) {
		const tool = asRecord(toolValue, `${vendor} payload.tools[${index}]`);
		const functionValue = tool.function;
		if (functionValue === undefined) continue;
		const functionData = asRecord(functionValue, `${vendor} payload.tools[${index}].function`);
		const name = requiredString(functionData, "name", `${vendor} payload.tools[${index}].function`);
		if (name.length > 64 || !/^[a-zA-Z0-9_-]+$/.test(name)) {
			throw new Error(
				`${vendor} tool name must contain only letters, numbers, underscores, or dashes and be at most 64 characters`,
			);
		}
	}
}

export function validateNumberRange(
	body: Record<string, unknown>,
	key: string,
	minimum: number,
	maximum: number,
	vendor: string,
): void {
	const value = body[key];
	if (value === undefined) return;
	if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
		throw new Error(`${vendor} payload.${key} must be between ${minimum} and ${maximum}`);
	}
}
