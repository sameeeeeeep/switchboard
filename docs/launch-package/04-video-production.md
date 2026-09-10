# Video production package

## Deliverable strategy

Produce three levels of video from the same evidence:

1. **Founder film, 60–75 seconds:** the gap you see, the product thesis, a concrete use case and an invitation.
2. **Product clips, 15–35 seconds:** one app and one interaction. These are the most reusable assets.
3. **Builder explanation, 45–60 seconds:** what the app supplies, what Switchboard connects, what the user controls.

The recordings in `media/` are real browser captures. AdForge uses the app’s labelled Allbirds sample; Brandbrain shows brief entry without submitting a generation request. These can support an interface demonstration, not a claim that a complete AI-powered brand launch was performed in the recording.

## Film A — “More things people can actually use”

**Length:** approximately 70 seconds. **Delivery:** conversational founder voice, steady pace, pauses after the opening and before the final question. **Visual character:** mostly real app footage, occasional black title frames, lime accents, dot-matrix headings. Do not put the whole monologue on screen.

| Time | Voiceover / spoken line | Picture | On-screen text |
|---|---|---|---|
| 0–6s | “My feed is full of people building with AI.” | Founder to camera, direct eye contact | BUILDING WITH AI |
| 6–13s | “But a lot of people I know are still figuring out ChatGPT. Claude Code sounds like something for developers.” | Founder, then clean cut to Brandbrain | USING IT SHOULD BE EASIER |
| 13–21s | “There’s a whole world of useful apps between those two groups—and too much setup in the way.” | Actual app entry screens, two deliberate cuts | Install. Connect. Explain again. |
| 21–29s | “So I’m building Switchboard. It connects apps to your AI, your tools and the project context you allow.” | Version 2 routing scene, showing the model and project connections | YOUR AI · YOUR TOOLS · YOUR CONTEXT |
| 29–40s | “If you’re building a brand, you should get an experience for building a brand. A brief, market research, decisions you can keep working on.” | Brandbrain brief-entry recording | BRANDBRAIN / BRAND WORKSPACE |
| 40–49s | “Then an ad creator can work from that brand context, instead of making you explain everything again.” | AdForge sample interaction; retain visible sample marking | ADFORGE / APP SAMPLE |
| 49–59s | “The apps can be lightweight. The setup is yours. Builders focus on the useful experience; users choose what each app can access.” | Real app screen → routing scene → access illustration | DIFFERENT APPS. YOUR SETUP. |
| 59–70s | “I want more of the things we’re building with AI to become things people actually use. What would you want to run this way?” | Founder to camera; finish on Switchboard name and URL | WHAT WOULD YOU USE IT FOR? |

**Important edit decision:** the Brandbrain and Allbirds clips are separate interface examples. Do not use a match cut or continuous project label that implies the Allbirds ads were generated from the Verra brief. A verified shared-project recording should replace that segment when available.

### Continuous voiceover script

My feed is full of people building with AI.

But a lot of people I know are still figuring out ChatGPT. Claude Code sounds like something for developers.

There’s a whole world of useful apps between those two groups—and too much setup in the way.

So I’m building Switchboard. It connects apps to your AI, your tools and the project context you allow.

If you’re building a brand, you should get an experience for building a brand. A brief, market research, decisions you can keep working on.

Then an ad creator can work from that brand context, instead of making you explain everything again.

The apps can be lightweight. The setup is yours. Builders focus on the useful experience; users choose what each app can access.

I want more of the things we’re building with AI to become things people actually use.

What would you want to run this way?

## Film B — “The app fits the job”

**Length:** 25 seconds. **Available footage:** Brandbrain brief entry. **No founder footage required.**

| Time | Picture | Caption |
|---|---|---|
| 0–3s | Black frame; small Switchboard mark | BUILDING A BRAND? |
| 3–9s | Brandbrain opens; cursor moves into brief | START WITH THE IDEA. |
| 9–16s | Type the Verra brief in the real app | A WORKSPACE FOR THE JOB. |
| 16–21s | Hold on the filled brief and market selector | CONNECT YOUR OWN AI. |
| 21–25s | Switchboard name and download URL | OPEN AN APP. USE YOUR SETUP. |

**Accompanying post:** Follow-up 1. **Do not imply:** a complete brand was generated. This clip shows the entry experience.

## Film C — “Three ad directions”

**Length:** 20–30 seconds. **Available footage:** AdForge’s built-in Allbirds sample.

| Time | Picture | Caption |
|---|---|---|
| 0–3s | AdForge, source field visible | AN INTERFACE FOR MAKING ADS |
| 3–7s | Click the app’s sample control | BUILT-IN SAMPLE |
| 7–14s | Three real concept cards | COMPARE THE DIRECTIONS. |
| 14–22s | Open one concept; read the full copy | WORK ON THE ONE YOU CHOOSE. |
| 22–27s | Return to Switchboard identity | YOUR AI RUNS THE REAL REQUESTS. |

Keep the sample badge visible. Do not add fake “generating” progress or remove the app’s “no tokens burned” message.

## Film D — “The brief comes with you”

**Length:** 35–45 seconds. **Capture status:** requires a verified, connected, shared-project run.

1. Open a real project in Brandbrain. Show its name and one brief field.
2. Save or expose the brand context using the app’s actual action.
3. Open AdForge through the actual supported route.
4. Show the same project name and a matching brief detail arriving.
5. Generate or display a result from that run, preserving the model/provider indication.
6. Return to the project and show the saved artifact if that action exists.

**Voiceover:** “This is the connection I care about most. The brief you made in one app can become the context for another. You choose access. The next app starts with the project, rather than a blank conversation.”

**Proof requirement:** match the project name, a distinctive brief phrase and the received context. No imported localStorage, DOM replacement, mocked API response or unrelated sample substitution.

## Film E — “A harness is more than a checklist”

**Length:** 45 seconds. **Use:** builder audience. **Visuals:** separate a labelled architecture animation from actual app footage.

**Voiceover:** “A fixed sequence of prompts can be a useful workflow. A harness needs to manage more: the agent’s instructions, its tools, project state, results and the next action. Switchboard connects that environment to the user’s AI and permitted resources. It doesn’t make every app autonomous. The app still has to make the agent useful for the job.”

**Shots:** app input → agent/environment → actual tool request → tool response → saved state → output. Show the return path. Avoid numbered step ticks, invented reasoning or a fake terminal.

## Film F — “Your voice, into the app”

**Length:** 15–20 seconds. **Capture status:** requires an actual Flow run.

**Action:** dictate a short launch update into an ordinary text field. Show the words appearing, including the correction of a known name if verified. If Ollama is involved, show that actual configuration rather than implying every dictation uses it.

**Spoken prompt:** “The Verra launch moves to Friday. The product photos are ready.”

**Captions:** SPEAK / TRANSCRIBE LOCALLY / KEEP WORKING.

## Film G — “What the builder supplies”

**Length:** 45–60 seconds. **Audience:** developers and people making small AI products.

- Open with the actual app interface for 5 seconds.
- Show a short, verified integration excerpt from the example source. Keep it to the call and required capability, not a wall of code.
- Highlight the boundary: app behaviour on one side; user AI, permitted context and configured tools on the other.
- End by returning to the actual interface.

**Voiceover:** “This app supplies the experience: the interface, the instructions and the behaviour for a task. Switchboard connects it to the user’s AI and the resources they allow. You still need to handle failures and build a useful product. But you don’t need to treat every app as a completely new AI setup.”

## Film H — “What first-time use taught me”

**Length:** 30–45 seconds. **Audience:** founder/build-in-public.

Use one actual issue found during capture. For example, AdPulse’s public sample currently hits a missing-element error. Show the issue only if you want a candid development post, then show the verified fix after it ships. Do not imply it has been fixed before verification.

**Structure:** what the user tried → what failed → why it matters → the change → the same action succeeding.

This is a strong follow-up because it demonstrates commitment to the usability problem described in the launch post.

## Filming notes for founder segments

- Camera at eye level; simple, quiet background; window light from one side.
- Record the whole script once, then record each paragraph separately for clean edits.
- Leave one second before and after each take. A calm delivery will work better than a fast feature list.
- Speak “Claude Code” and “Codex” distinctly. Explain the useful task before saying “harness.”
- Record clean voice. Add music only if licensed and if it does not obscure speech.
- Desktop captures: use a clean browser profile and a clearly identified demo project. Keep private accounts, notifications, tokens and personal data out of frame.

## Editing and export

- Make a landscape master and a vertical adaptation. Reframe around the active interaction; do not shrink a whole desktop screen until its text is unreadable.
- Use a 4:5 or 9:16 composition for short clips when the active panel can remain readable. Keep the full desktop version for product explanations.
- Use H.264 MP4, AAC when audio is present, and a consistent frame rate. These are practical export choices, not claims about a platform’s current maximum limits.
- Captions: maximum two short lines at a time. Use real UI labels for exact names; avoid a sentence explaining every cursor movement.
- Export a clean master and a captioned master. Keep original recordings so the edit can be changed without rerecording.
- Keep app-provided sample labels in frame or state the sample status clearly in the edit. Never label an interface walk-through as live generation.

## Thumbnail options

1. **YOUR AI. MORE WAYS TO USE IT.** Real app window behind the Switchboard mark.
2. **WHAT IF THIS RAN ON YOUR CLAUDE?** Actual Brandbrain brief screen, provider mark nearby.
3. **STOP REPEATING THE BRIEF.** A real project handoff, only after verified capture.
4. **BUILD THE APP. CONNECT THEIR AI.** App screenshot and a small integration excerpt.

Pick one message per thumbnail. The screenshot should remain recognisable at small size; the title should not cover the interaction.
