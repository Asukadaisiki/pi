# Native Flow Design

Status: Phase 1 implemented and verified in an Extension Development Host with an active language provider; Phases 2-4 proposed

This document specifies a native, read-only Flow capability for `asuka.pi`. Flow builds a task-scoped semantic graph around a selected symbol, renders it as an interactive terminal pipeline, observes code changes, and publishes a compact deterministic summary to the agent runtime.

The first implementation is an observer. It does not edit files, approve changes, block tools, or ask an LLM to interpret graph updates.

## Decision summary

- `/flow` is a built-in interactive command, not an extension command and not an LLM-callable tool.
- The initial entry point is `/flow <symbol-query>`.
- Symbol search, selection, graph navigation, refresh, and source navigation are deterministic local interactions.
- A small VS Code companion extension exposes existing language-provider results to Pi. The terminal remains the primary UI.
- Flow state is owned by `AgentSession`, follows session branches, and is not stored as ordinary conversation messages.
- The LLM receives only a bounded `active_flow` system-prompt block, recomputed from the latest Flow revision before each provider request.
- The read-only sample supports one workspace, one active Flow, depth two, and a bounded number of nodes.

## Goals

1. Replace repeated text search and manual source navigation with a task-scoped semantic pipeline.
2. Let a user select a symbol without relying on editor focus or an LLM.
3. Distinguish confirmed diagnostics, semantic topology changes, and review-only impact.
4. Update the displayed pipeline after user or Agent file changes without invoking an LLM.
5. Give the next LLM request a compact, current description of the active pipeline.
6. Establish interfaces that can later support guarded edits without coupling graph construction to the TUI.

## Non-goals for the observer

- Editing or generating code.
- Blocking `edit`, `write`, or `bash`.
- Runtime tracing.
- Proving that a graph contains every possible dynamic call.
- Cross-workspace or cross-repository analysis.
- Generic LSP process management.
- RPC UI support.
- Automatic behavioral correctness claims.

## User interaction

### Command syntax

```text
/flow <symbol-query>
```

Examples:

```text
/flow createAgentSession
/flow setActiveTools
/flow AgentSession prompt
```

`/flow` without arguments reopens the active Flow. If no Flow exists, Pi displays:

```text
Usage: /flow <function-or-symbol-name>
```

The command never becomes a user message and never starts an Agent turn.

### Symbol selection

Pi sends the query to the semantic provider and then applies local normalization, filtering, and fuzzy ranking. The selector always appears, including for one exact match, so selection remains an explicit user decision.

```text
 FLOW SYMBOL SEARCH                                      query: createAgentSess

 > function  createAgentSession
             packages/coding-agent/src/core/sdk.ts:169

   function  createAgentSessionFromServices
             packages/coding-agent/src/core/agent-session-services.ts:200

   function  createAgentSessionRuntime
             packages/coding-agent/src/core/agent-session-runtime.ts:411

   method    createSessionManager
             packages/coding-agent/src/main.ts:246

 up/down navigate   enter select   esc cancel
```

Candidate rows show:

- symbol kind;
- qualified symbol name;
- workspace-relative file and line;
- container name when the provider supplies one.

The selector displays at most ten rows at once. It excludes symbols outside the active workspace and excludes dependency, generated, and build-output directories by default.

Ranking is deterministic:

1. case-sensitive exact name;
2. case-insensitive exact name;
3. name prefix;
4. qualified-name or word-prefix match;
5. fuzzy subsequence match;
6. workspace-relative path match.

Ties are ordered by source before tests, shorter qualified name, relative path, then source position. Provider result order is not used as a final tie-breaker.

### Loading

After selection, the editor is replaced with a cancellable loader:

```text
 FLOW  resolving createAgentSession

 symbols  8    calls  12    references  31
 esc cancel
```

Cancellation aborts outstanding bridge requests and returns to the symbol selector.

### Pipeline view

The primary layout is a spine with attached branches rather than an unrestricted force-directed graph.

```text
 FLOW  createAgentSession                         OBSERVING  rev 4
 nodes 12   edges 17   changed 1   errors 0

 [01] main.createRuntime
        |
        v call
 [02] createAgentSessionFromServices
        |
        v call
 [03] createAgentSession
        |
        +------> [04] ModelRuntime.create
        |
        v call
 [05] AgentSession.constructor
        |
        +------> [06] _installAgentToolHooks
        |
        v call
 [07] _buildRuntime
        |
        v call
>[08] _refreshToolRegistry                         * modified
        |
        +....> [09] wrapRegisteredTools             reference
        |
        v call
 [10] setActiveToolsByName

 impact: [08] body changed; 2 direct callers require review
```

ASCII characters carry meaning. ANSI color is an enhancement, not the only encoding.

```text
!  confirmed error
~  review required
*  directly changed
+  added node or edge
-  removed node or edge
?  manual or inferred relation
=  unchanged
>  current selection
```

Initial keys:

```text
up/down or j/k   select node
enter            open source location in VS Code
r                references
i                incoming calls
o                outgoing calls
tab              graph / impact / diagnostics
g                refresh
backspace         return to symbol results
q or esc          close Flow
```

The graph view is local UI state. Moving the selection or switching tabs does not append session entries and does not update LLM context.

## Semantic provider architecture

Core Flow code depends on an interface rather than VS Code APIs:

```ts
interface FlowSemanticProvider {
  searchSymbols(query: string, signal?: AbortSignal): Promise<FlowSymbolCandidate[]>;
  resolveSymbol(location: FlowLocation, signal?: AbortSignal): Promise<FlowSymbol | undefined>;
  getDefinition(location: FlowLocation, signal?: AbortSignal): Promise<FlowLocation[]>;
  getReferences(symbol: FlowSymbol, signal?: AbortSignal): Promise<FlowLocation[]>;
  getIncomingCalls(symbol: FlowSymbol, signal?: AbortSignal): Promise<FlowCall[]>;
  getOutgoingCalls(symbol: FlowSymbol, signal?: AbortSignal): Promise<FlowCall[]>;
  getImplementations(symbol: FlowSymbol, signal?: AbortSignal): Promise<FlowLocation[]>;
  getContractText(symbol: FlowSymbol, signal?: AbortSignal): Promise<string | undefined>;
  getDiagnostics(uri: string, signal?: AbortSignal): Promise<FlowDiagnostic[]>;
  openLocation(location: FlowLocation): Promise<void>;
  onDocumentsChanged(listener: (event: FlowDocumentsChangedEvent) => void): () => void;
}
```

The provider uses serializable Flow types only. No `vscode.Uri`, `vscode.Range`, TUI component, or Agent type crosses this interface.

### VS Code bridge

The first adapter is a small desktop VS Code extension. It invokes:

- `vscode.executeWorkspaceSymbolProvider`;
- `vscode.executeDocumentSymbolProvider`;
- `vscode.executeDefinitionProvider`;
- `vscode.executeReferenceProvider`;
- `vscode.executeImplementationProvider`;
- `vscode.prepareCallHierarchy`;
- `vscode.provideIncomingCalls`;
- `vscode.provideOutgoingCalls`;
- `vscode.executeHoverProvider` for a best-effort contract fingerprint;
- `languages.getDiagnostics` and `onDidChangeDiagnostics`;
- `workspace.onDidChangeTextDocument` and `onDidSaveTextDocument`;
- `window.showTextDocument` for navigation.

The bridge exposes a versioned local protocol over a named pipe on Windows and a Unix domain socket on Unix. A random per-process token and canonical workspace root are part of the handshake. Both sides reject locations outside the matched workspace.

Discovery metadata belongs under the OS temporary directory, not inside the repository. The first version supports local VS Code desktop workspaces only. Remote SSH, WSL, containers, and browser workspaces are explicit follow-up work.

If no compatible bridge is available, `/flow <query>` shows an actionable error and does not fall back to grep. Text search results must not be presented as semantic symbols.

## From provider results to a Flow graph

Raw language-provider locations are not a feature graph. They pass through a deterministic pipeline:

```text
provider results
      |
      v
URI/range normalization
      |
      v
smallest enclosing symbol resolution
      |
      v
stable symbol identity and deduplication
      |
      v
typed edge construction
      |
      v
bounded graph expansion
      |
      v
snapshot diff and impact propagation
      |
      v
ASCII layout
```

### Symbol identity

Ranges move after edits and cannot be primary identifiers. A node key is derived from:

```text
workspace-relative URI
+ language id
+ qualified symbol name
+ symbol kind
+ enclosing symbol path
```

The last known selection range is a resolution hint. When a document changes, Flow first matches the stable key against fresh document symbols and falls back to the nearest compatible symbol around the previous position.

### Edge types

The observer recognizes:

```text
call             confirmed call hierarchy edge
reference        non-call reference
implementation   implementation/type relation
contains         enclosing symbol relation
manual           user-supplied relation, reserved for later phases
```

Every semantic edge keeps its evidence locations. The renderer can therefore open the exact call or reference instead of only the target definition.

### Expansion limits

Initial defaults:

```text
incoming depth     2
outgoing depth     2
maximum nodes     40
maximum edges    120
maximum refs per node shown in graph  20
```

Additional references remain available in the reference tab without becoming graph nodes. Cycles are detected and rendered once with a back-edge marker.

## Change observation and impact

### Event handling

Unsaved text changes update the UI after a 300 ms debounce and are marked provisional. Saved changes trigger an authoritative refresh. Diagnostics refresh independently when VS Code emits a diagnostics change.

Only changed documents and adjacent graph nodes are re-queried. A full rebuild remains available through `g`.

### Change classes

```ts
type FlowNodeChange =
  | "content"
  | "contract"
  | "topology"
  | "diagnostic"
  | "added"
  | "removed";
```

- `content`: source changed but the exposed contract and semantic edges did not.
- `contract`: normalized hover/declaration text changed.
- `topology`: incoming or outgoing semantic edges changed.
- `diagnostic`: VS Code reported a new or resolved diagnostic.
- `added` or `removed`: a graph symbol appeared or can no longer be resolved.

### Impact rules

Flow never promotes a possible impact to a confirmed error.

1. Diagnostics are displayed as confirmed errors or warnings at their containing node.
2. A contract change marks direct callers and references as `review required`.
3. An outgoing-edge change marks the changed node and added/removed targets.
4. A body-only change marks direct callers for review but does not recursively flood the graph.
5. A removed symbol becomes stale; callers become confirmed errors only when diagnostics or failed definition resolution provide evidence.
6. Transitive propagation stops after one reverse edge in the observer.

Example after a required parameter is added:

```text
* setActiveToolsByName          contract changed
! _refreshToolRegistry          missing argument (diagnostic)
! extension setActiveTools      incompatible call (diagnostic)
~ _buildRuntime                 upstream review
```

Example after only the function body changes:

```text
* setActiveToolsByName          body changed
~ _refreshToolRegistry          direct caller review
= no diagnostics
= topology unchanged
```

## Native runtime ownership

### FlowManager

`AgentSession` owns one `FlowManager`. The manager is UI-neutral and coordinates:

- the semantic provider;
- active query and selected seed;
- graph snapshots and revisions;
- provisional and saved document changes;
- diagnostics;
- branch-aware persistence;
- compact LLM context serialization.

The TUI subscribes to Flow events. It does not build graphs or mutate session files directly.

### Session persistence

Add a first-class session entry:

```ts
interface FlowStateEntry extends SessionEntryBase {
  type: "flow_state";
  state: FlowCheckpoint;
}
```

`FlowCheckpoint` contains the selected seed, normalized graph snapshot, current revision, query, expansion limits, and document fingerprints. It does not participate in `buildSessionContext()`.

Flow appends checkpoints only when:

- a seed is selected;
- an authoritative saved graph revision is accepted;
- the Flow is closed or replaced;
- a future guarded scope is approved.

Cursor movement, tab switches, provisional unsaved changes, and selection changes are not persisted.

Because entries follow the existing parent chain, `/tree`, `/fork`, `/clone`, and session resume restore the Flow state at that branch. On restoration, cached graph data is displayed as stale until the semantic provider refreshes it.

Adding the entry type requires no migration of older sessions. Exhaustive session-entry switches must explicitly ignore or render it.

## Synchronizing Flow with the LLM

The graph itself is not copied into conversation messages. Instead, Flow produces a compact deterministic block:

```text
<active_flow version="1" revision="4" status="observing">
seed: createAgentSession (packages/coding-agent/src/core/sdk.ts:169)
scope: 12 symbols in 6 files; incoming-depth=2; outgoing-depth=2
changed:
- _refreshToolRegistry: content changed
diagnostics: 0 errors, 0 warnings
impact:
- _buildRuntime: direct caller review
topology: unchanged
note: semantic graph is static and may omit dynamic dispatch
</active_flow>
```

Serialization rules:

- stable ordering;
- workspace-relative paths;
- no source bodies;
- no full reference list;
- at most 12 changed or impacted nodes;
- at most 4 KiB;
- an explicit truncation marker when limits are reached.

### Prompt composition

`AgentSession` needs one prompt-composition method:

```text
base system prompt
      |
extension system-prompt override, when present
      |
native active_flow block
      |
effective request system prompt
```

The native Flow block is appended after an extension override so an unrelated extension cannot accidentally remove active Flow state.

The effective prompt is applied:

1. before the first provider request started by `AgentSession.prompt()`;
2. in `prepareNextTurnWithContext` before every subsequent tool turn;
3. after tool definitions or Flow revision changes.

This reuses the current next-turn refresh point that already refreshes tools, model, thinking level, and system prompt. A user edit received while the Agent is running therefore becomes visible on the next provider request without steering, follow-up messages, or another LLM call solely for synchronization.

Flow checkpoints remain outside conversation messages and compaction. The system block is request state, not conversation history.

### What the model receives

The model receives:

- the selected feature seed;
- bounded scope counts;
- changed nodes;
- confirmed diagnostics;
- direct review impacts;
- topology deltas;
- an incompleteness warning.

It does not receive:

- current TUI selection;
- navigation history;
- every node and reference;
- provisional keystroke-level updates;
- raw VS Code response objects.

## Built-in command integration

`flow` is added to `BUILTIN_SLASH_COMMANDS` with argument hint `<symbol>`.

Interactive submission handles `/flow` before bash and prompt dispatch, just like other built-in UI commands. The handler delegates business logic to `FlowManager` and only owns selectors, loaders, rendering, and focus restoration.

The base autocomplete provider may offer symbol argument completion later, but the observer deliberately opens the full selector after submission. This avoids running workspace-wide semantic queries on every editor keystroke.

The observer is interactive-only. Print and JSON modes do not interpret `/flow`. RPC additions are deferred until the core protocol stabilizes.

## Proposed source layout

```text
packages/coding-agent/src/core/flow/
  types.ts
  semantic-provider.ts
  flow-manager.ts
  graph-builder.ts
  graph-diff.ts
  impact-analyzer.ts
  context-serializer.ts
  bridge-client.ts
  protocol.ts
  index.ts

packages/coding-agent/src/modes/interactive/components/
  flow-symbol-selector.ts
  flow-loader.ts
  flow-view.ts

packages/vscode-flow-bridge/
  package.json
  src/extension.ts
  src/semantic-service.ts
  src/transport.ts
```

`protocol.ts` is exported from `asuka.pi` so the VS Code bridge consumes the same versioned request, response, and notification types.

## Expected existing-file changes

### Required for the observer

- `packages/coding-agent/src/core/slash-commands.ts`
  - register `/flow` metadata.
- `packages/coding-agent/src/modes/interactive/interactive-mode.ts`
  - dispatch the built-in command and host Flow components.
- `packages/coding-agent/src/core/agent-session.ts`
  - own `FlowManager` and compose effective per-request system prompts.
- `packages/coding-agent/src/core/agent-session-services.ts`
  - create the semantic bridge/provider service for the current cwd.
- `packages/coding-agent/src/core/agent-session-runtime.ts`
  - dispose and recreate Flow services during cwd/session replacement.
- `packages/coding-agent/src/core/sdk.ts`
  - accept an optional `FlowSemanticProvider` for embedded use and tests.
- `packages/coding-agent/src/core/session-manager.ts`
  - define, append, restore, and ignore `flow_state` for LLM context.
- `packages/coding-agent/src/index.ts`
  - export public Flow provider and protocol types.
- `packages/coding-agent/package.json`
  - expose the shared protocol subpath if needed by the bridge.
- root `package.json`
  - add the companion package to build/check flows when implementation begins.
- `packages/coding-agent/docs/session-format.md`
  - document `flow_state`.
- `packages/coding-agent/docs/usage.md`
  - document `/flow` after the feature is implemented.
- `packages/coding-agent/docs/index.md`
  - link user documentation after implementation.

### Deferred for guarded editing

- `packages/coding-agent/src/core/tools/edit.ts`
- `packages/coding-agent/src/core/tools/write.ts`
- `packages/coding-agent/src/core/agent-session.ts` tool preflight
- settings manager and settings selector for Flow enforcement policy
- RPC command and response types

The observer must not modify built-in edit/write behavior.

## Testing strategy

### Core tests

- deterministic symbol ranking;
- location-to-enclosing-symbol resolution;
- stable node identity after line movement;
- graph deduplication and cycle handling;
- node/edge limits;
- snapshot diff classification;
- bounded impact propagation;
- deterministic 4 KiB context serialization;
- Flow revision changes reflected by next-turn prompt composition;
- `flow_state` branch, fork, clone, compaction, and resume behavior.

### TUI tests

- candidate selection and cancellation;
- narrow and wide terminal rendering;
- graph navigation and tab switching;
- no ANSI-dependent information;
- source-open failure restores the Flow view;
- async refresh does not replace a newer query result.

### Session/Agent regression

Use the faux provider harness to verify:

1. `/flow` itself does not start an LLM turn;
2. the next real user prompt contains one `active_flow` system block;
3. a Flow revision received after an edit tool result appears on the next provider request;
4. Flow state does not appear as a user/custom message;
5. compaction does not summarize Flow state;
6. extension system-prompt overrides retain the native Flow block.

### Manual acceptance

Run Pi in the VS Code integrated terminal against this repository:

1. enter `/flow createAgentSess`;
2. select `createAgentSession` from multiple fuzzy matches;
3. inspect the two-level ASCII pipeline;
4. press Enter on nodes and verify exact VS Code navigation;
5. edit `setActiveToolsByName` manually;
6. verify provisional, saved, diagnostic, and impact updates;
7. send a normal prompt and inspect the actual provider context for the current Flow revision;
8. resume and branch the session and verify Flow restoration.

## Delivery phases

### Phase 1: semantic spike

- versioned bridge protocol;
- VS Code symbol search and source opening;
- no graph persistence or Agent integration.

Exit criterion: `/flow <query>` selects a symbol and Enter opens the exact source location.

### Phase 2: observer graph

- graph construction;
- ASCII pipeline and detail tabs;
- file/diagnostic notifications;
- snapshot diff and impact rules.

Exit criterion: a manual function change updates the graph without an LLM call and correctly separates diagnostics from review impact.

### Phase 3: native session and Agent context

- `FlowManager` owned by `AgentSession`;
- `flow_state` checkpoints and branch restoration;
- per-request `active_flow` prompt composition;
- faux-provider regression coverage.

Exit criterion: the actual next provider request contains the current bounded Flow revision, including after a mid-run edit.

### Phase 4: guarded editing

This is a separate design and implementation phase. It can use the trusted observer graph to approve files and intercept mutation tools. It must not be bundled into the first observer implementation.

## Open decisions before implementation

1. Whether the VS Code bridge is published as a separate extension or distributed alongside the npm package with an install command.
2. Whether `flow_state` stores the full bounded graph or only a compact graph plus document fingerprints.
3. Whether contract fingerprints use normalized hover text only or language-specific declaration extraction when hover is unavailable.
4. Whether source/tests ordering should be configurable before the first release.
5. Whether a future direct LSP provider must match the same protocol exactly or only the `FlowSemanticProvider` interface.

None of these decisions changes the `/flow <query>` interaction or the separation between terminal UI, semantic adapter, session state, and LLM request context.
