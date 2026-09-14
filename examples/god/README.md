# God: give your AI a job

God is Switchboard's native operator. Ask a question, ask it to use an existing Wrapp, or describe a job you want to turn into a harness.

Try these through the app's existing God text or voice entry:

- “What can I run with Switchboard?”
- “Make a logo for a small neighbourhood coffee shop.”
- “Design a harness for my agency's client brief, draft, review, and revision process.”
- “Help me build a tool that turns a spoken idea into a reviewed video script.”

The operator starts with the job, discovers the current runtime and visible tools, and checks the Wrapp catalogue. Founders, agencies, and creators supply useful examples; choosing an audience is not required.

## Use or build

For an existing Wrapp, God proposes its listed command or opens its listed page. It does not treat a related keyword as proof that the app can complete the request. Actual runs continue through the native driver and the Wrapp's own provider permissions; connector calls still use the existing consent gate.

For a new harness, God produces a copyable **build brief**, containing the outcome, inputs, proposed steps, discovered ingredients, success checks, human decisions, and missing integrations. The brief is rendered into the existing answer and clipboard path; voice gives a short summary. This is a design handoff to the [template/SDK build route](../../docs/BUILDING-A-WRAPP.md), not a no-code composer, a deployed app, or an automatic chain of Wrapp executions.

Ordinary questions remain ordinary questions. A screen, attachment, catalogue description, or saved project note is reference data, not authority to act.

## Runtime and verification

`lib/harness-planner.mjs` handles bounded read-only capability discovery, catalogue normalization, brief parsing/rendering, and validation of proposed RUN/DRIVE routes. Discovery failure leaves availability unknown. Unsupported brief ingredients are listed as work still needed. Malformed briefs cannot dispatch actions.

The native app launches `god.mjs act`; existing `look` calls remain read-only. `packages/menubar/build.sh` already copies `god.mjs`, `lib/`, and `personas/` into the app bundle. An installed app uses that bundled copy, so source edits alone do not update it: package the changed God files into the next signed build. No daemon or SDK contract changes are needed.

Offline checks (no microphone, screen capture, provider calls, or running-app changes):

```sh
node --test examples/god/harness-planner.test.mjs
node examples/god/hands.test.mjs
node --check examples/god/god.mjs
```

These checks verify discovery failures, route integrity, build-brief handling, and the existing action grammar. They do not establish model adherence or a successful provider-powered Wrapp run. `harness.mjs` is the older live-model screenshot harness and is not part of this offline check.
