/** Create a fetch implementation that ignores SDK-generated paths. */
export function createExactUrlFetch(url: string): typeof globalThis.fetch {
	return async (_input, init) => globalThis.fetch(url, init);
}
