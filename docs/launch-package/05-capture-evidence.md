# Capture evidence and outstanding proof

Captured from actual running interfaces in a clean browser profile. No private user data, injected results or simulated AI completions were used.

## Verified

- **Brandbrain** — https://brandbrain.thelastprompt.ai/build. Initial workspace loading eventually resolves to the real brand-entry UI. The captured entry screen includes the real sidebar, brief field and launch-market control.
- **AdForge** — https://adforge.thelastprompt.ai. The built-in Allbirds sample opens three concept cards. The app labels it SAMPLE and reports that no tokens were used. This is appropriate footage for an interface walkthrough.
- **Crest** — bundled app at http://localhost:5188/crest.html. The actual entry screen shows a sample brief and requires a connection to make a logo. Do not treat the entry screenshot as generated logo output.
- **Shared brand context** — the current AdForge source imports the context/lending integration and supports a brand supplied through Switchboard. This proves an implementation path; it is not a substitute for recording an end-to-end run.

## Issue found while capturing

The public AdPulse sample fails with `Cannot set properties of null (setting 'disabled')`. Current source references `stale-rerun` in `reflect()`, while the public HTML used during capture lacks that element. This is consistent with a deployed HTML/JavaScript mismatch. No claim is made that this has been repaired or deployed.

The error screenshot is evidence, not promotional media. Do not use it as the sample-account demo promised in the content plan.

## Still needs a connected recording

- A brand created or opened in Brandbrain, lent through Switchboard, then received by AdForge with matching context.
- A real model request completing through Claude Code or Codex, with the actual provider and result visible.
- A real Crest logo generation.
- A real Flow local dictation run.
- An actual per-app grant screen, rather than the landing-page permission illustration.

These are high-value next captures. The production scripts separate them from assets already available so an editor cannot accidentally imply that they were recorded.
