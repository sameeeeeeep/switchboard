# Codex backend validation

Validated on 2026-09-06 against the working tree on `codex/codex-backend`, based on
`0fc617c`. These results cover the Codex integration and fixes below.

**Verdict: the backend source is ready to push and package as a release candidate.**
The signed Mac distribution still needs a fresh-install smoke test before release.

## Environment

- Codex CLI: `0.135.0`, authenticated through the existing Codex sign-in.
- Live model: `gpt-5.5`, selected from the runtime's advertised catalog.
- Test host Node.js: `22.14.0`.
- Live proofs used temporary Switchboard state and synthetic inputs. They did not
  import personal MCP servers or replace the installed app.

## Results

| Check | Result |
| --- | --- |
| Backend, routing, permission, discovery and storage tests | 34 passed; 0 failed or skipped |
| Protocol and sidekick builds | Passed |
| SDK and extension builds | Passed |
| Example app bundles and Brandbrain bootstrap | Rebuilt successfully with the updated shared SDK |
| Workspace typechecks | Passed |
| Native Swift typecheck | Passed with compiler warnings; not a signed app build |
| Standalone Swift client with real local AI and voice | All eight native/web integration checks passed |
| Brandbrain's actual 32-route API bundle | Built successfully; gaps route passed against real Codex |
| Brandbrain warm-session and MCP proof | Passed again after the fixes |
| Packaged daemon through the real WebSocket protocol | All seven live checks passed |
| Git whitespace check | Passed |
| Clean checkout before merge | Fresh dependency install, full builds, workspace typechecks and all 34 tests passed |

The packaged-daemon proof used the Mac packager's daemon bundling settings. It verified:

1. Codex discovery and the model-selection consent round trip.
2. Parallel apps with separate warm threads and legacy model-name translation.
3. Streaming text and usage, with conversation memory isolated by app.
4. Resuming the original thread after a daemon restart, with private session files.
5. Image attachments reaching Codex vision.
6. Ending a conversation and creating a fresh thread on the next request.
7. App feature discovery and live model preference notifications, without widening grants.

The Brandbrain proof registered only Codex. Its existing warm-session shim retained
context, its real gaps route returned three scored openings, and its MCP calls went
through Switchboard's Gate. Revoking the grant prevented further tool execution.

## Issues fixed during validation

- **Permissions changing during approval:** Gate now rechecks the current grant,
  tool access and read-only mode after approval and immediately before invocation.
- **Runtime failure during approval:** completing or failing a Codex turn now
  cancels pending Gate work, preventing a later approval from executing stale work.
- **All models disabled:** background routine drafting no longer selects a fallback
  backend when no model is available.
- **Ending a conversation:** the daemon now clears cached completion resume tokens
  as well as the provider session and model pin.

Regression tests cover these fixes, missing-runtime discovery, and fresh threads
when the persona or tool schemas change.

## Model selection and app discovery follow-up

BYOP 1.3 now exposes model/backend feature metadata, each app's effective default,
conversation pinning, and capability invalidation events. The live daemon test toggled
a model off and on, observed the events through WebSocket, checked the updated catalog,
and verified that the app's grant stayed unchanged.

Native settings and the command centre allow disabling every model in a provider group.
Unavailable models cannot be newly selected in the extension. Reopening consent preserves
the user's current default. The shared connection chip refreshes when models change.
The native source typecheck, workspace checks, and updated app bundle builds passed.

Custom app pickers must adopt the [discovery contract](MODEL-DISCOVERY.md), and existing
deployed bundles must be republished to receive updated shared SDK controls. These tests
do not claim a signed app installation or browser UI interaction test.

## Native and local follow-up

Native discovery now lists only implemented transport methods and includes private
storage, context, permissions and sessions. Model-change events reach standalone native
clients and hosted app windows; scoped events stay with their owning app. Per-app token
revocation is checked on open native sockets, not only at initial authentication.

Regression coverage verifies these boundaries, prevents an app from overwriting another
app's published context, and checks that local text models reject images and tool loops.
The cancellation fixture now waits for an actual running turn before aborting, avoiding
a startup-timing assumption on a busy host. All 34 tests passed, and the seven real Codex
release checks passed again after the broker changes.

Local recognizer configuration is exposed through `local.stt`; the SDK now includes
`transcribe`. See [native and local integration](NATIVE-AND-LOCAL.md) for the separate
Foundation client, local model requirements and reproducible integration proof.

The standalone proof passed using Ollama `llama3.2:1b`, macOS `Samantha` speech and
local `whisper-cli` with `ggml-base.en.bin`. It compiled a Foundation-only executable
outside the Switchboard bundle and verified:

1. Interactive native registration and accurate capability discovery.
2. Native private storage and publishing an app-owned context.
3. Real local text generation with model identity and output-token usage.
4. Synthetic on-device speech transcribed by local Whisper.
5. Live model preference notifications on the native connection.
6. The same Ollama model through the web transport.
7. Private-data isolation and explicit native-to-web context lending.
8. Token-derived identity, revocation of existing connections and rejection of browser Origins.

This used a synthetic consent surface restricted to test identities, not a GUI consent
click-through. It proves an independent native process can use Switchboard; it does not
claim a signed application installation, native streaming, or writing-quality parity
between tiny local models and Claude/Codex.

## Reproduce

From the repository root, with dependencies installed:

```sh
npm run build -w @relay/protocol
npm run build -w @relay/sidekick
npm run build -w @relay/sdk
npm run build -w @relay/extension
npm run typecheck
node --test packages/sidekick/dist/backends/codex.test.js packages/sidekick/dist/backends/routing.test.js packages/sidekick/dist/storage/find.test.js
SKIP_FRONTEND=1 node examples/brandbrain-port/build.mjs
node examples/brandbrain-port/proof/run-codex.mjs
node examples/brandbrain-port/proof/run-codex-release.mjs
git diff --check
```

The live proofs make real model calls. Brandbrain's build also requires its existing
source and dependencies; see [Codex setup](CODEX.md).

## Release boundary

The merge was validated in an isolated checkout containing only the selected source,
tests and docs. The lockfile was repaired to include the existing Switchboard MCP
workspace and its dependency entries, preserving already-locked dependency versions.

The backend was exercised headlessly using an installed, signed-in Codex CLI. A
clean-machine CLI onboarding test, a rebuilt signed/notarized DMG, and a fresh app
installation were not part of this run. The native source was typechecked and the
packaged daemon was tested independently.

Claude-only connectors do not automatically transfer to Codex; equivalent tools
must be exposed through Switchboard MCP. The tested App Server version also has
experimental fields and no strict per-turn `maxTokens` cap. See the
[compatibility boundaries](CODEX.md#compatibility-boundaries) before changing runtime
versions or promising parity across every app workflow.

This working tree includes unrelated pre-existing changes. These results are not
an audit of those changes or of the checked-in app bundle.
