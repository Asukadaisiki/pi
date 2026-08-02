import type { FlowSymbolCandidate } from "./protocol.ts";

interface RankedCandidate {
	candidate: FlowSymbolCandidate;
	matchClass: number;
	matchCost: number;
	isTest: boolean;
}

function fuzzySubsequenceCost(value: string, query: string): number | undefined {
	let valueIndex = 0;
	let firstMatch = -1;
	let lastMatch = -1;
	for (const queryCharacter of query) {
		const nextIndex = value.indexOf(queryCharacter, valueIndex);
		if (nextIndex === -1) return undefined;
		if (firstMatch === -1) firstMatch = nextIndex;
		lastMatch = nextIndex;
		valueIndex = nextIndex + 1;
	}
	return firstMatch + (lastMatch - firstMatch + 1 - query.length);
}

function wordPrefixMatch(value: string, query: string): boolean {
	const words = value.split(/[^a-zA-Z0-9_$]+/).filter(Boolean);
	return words.some((word) => word.toLowerCase().startsWith(query));
}

function getMatch(
	candidate: FlowSymbolCandidate,
	query: string,
): Pick<RankedCandidate, "matchClass" | "matchCost"> | undefined {
	const trimmedQuery = query.trim();
	if (!trimmedQuery) return undefined;
	const lowerQuery = trimmedQuery.toLowerCase();
	const lowerName = candidate.name.toLowerCase();
	const lowerQualifiedName = candidate.qualifiedName.toLowerCase();
	const lowerPath = candidate.relativePath.toLowerCase();

	if (candidate.name === trimmedQuery) return { matchClass: 0, matchCost: 0 };
	if (lowerName === lowerQuery) return { matchClass: 1, matchCost: 0 };
	if (lowerName.startsWith(lowerQuery)) return { matchClass: 2, matchCost: lowerName.length - lowerQuery.length };

	const tokens = lowerQuery.split(/\s+/).filter(Boolean);
	if (
		tokens.every(
			(token) =>
				wordPrefixMatch(lowerQualifiedName, token) ||
				wordPrefixMatch(lowerName, token) ||
				wordPrefixMatch(lowerPath, token),
		)
	) {
		return { matchClass: 3, matchCost: lowerQualifiedName.length - lowerQuery.length };
	}

	let fuzzyCost = 0;
	for (const token of tokens) {
		const costs = [fuzzySubsequenceCost(lowerName, token), fuzzySubsequenceCost(lowerQualifiedName, token)].filter(
			(cost): cost is number => cost !== undefined,
		);
		if (costs.length === 0) {
			fuzzyCost = -1;
			break;
		}
		fuzzyCost += Math.min(...costs);
	}
	if (fuzzyCost >= 0) return { matchClass: 4, matchCost: fuzzyCost };

	if (lowerPath.includes(lowerQuery)) {
		return { matchClass: 5, matchCost: lowerPath.indexOf(lowerQuery) };
	}
	const pathCost = fuzzySubsequenceCost(lowerPath, lowerQuery);
	return pathCost === undefined ? undefined : { matchClass: 5, matchCost: pathCost };
}

function isTestPath(relativePath: string): boolean {
	return /(^|\/)(test|tests|__tests__)(\/|$)|\.(test|spec)\.[^/]+$/i.test(relativePath.replace(/\\/g, "/"));
}

export function rankFlowSymbolCandidates(
	candidates: readonly FlowSymbolCandidate[],
	query: string,
): FlowSymbolCandidate[] {
	const seen = new Set<string>();
	const ranked: RankedCandidate[] = [];
	for (const candidate of candidates) {
		const key = [
			candidate.qualifiedName,
			candidate.kind,
			candidate.relativePath,
			candidate.location.range.start.line,
			candidate.location.range.start.character,
		].join("\0");
		if (seen.has(key)) continue;
		seen.add(key);
		const match = getMatch(candidate, query);
		if (!match) continue;
		ranked.push({ candidate, ...match, isTest: isTestPath(candidate.relativePath) });
	}

	ranked.sort((left, right) => {
		return (
			left.matchClass - right.matchClass ||
			left.matchCost - right.matchCost ||
			Number(left.isTest) - Number(right.isTest) ||
			left.candidate.qualifiedName.length - right.candidate.qualifiedName.length ||
			left.candidate.relativePath.localeCompare(right.candidate.relativePath) ||
			left.candidate.location.range.start.line - right.candidate.location.range.start.line ||
			left.candidate.location.range.start.character - right.candidate.location.range.start.character
		);
	});
	return ranked.map((entry) => entry.candidate);
}
