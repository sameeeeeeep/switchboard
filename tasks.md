# Tasks

## Switchboard
- [ ] Research wigolo repo for reuse id:wg01 epic:oss-scouting prio:med status:backlog
  Figure out what wigolo actually does and whether its code/architecture is relevant to us.
  - [ ] Find and skim the wigolo source/README id:i3fr
  - [ ] Note license and integration constraints id:xsdn
- [ ] Research voicebox clone repo for reuse id:vb02 epic:oss-scouting prio:med status:backlog
  Evaluate the open-source Voicebox clone as a reference for TTS/voice-cloning work.
  - [ ] Review model architecture and training approach id:m98t
  - [ ] Check license and inference/hosting requirements id:rae6
- [ ] Define our use case for these references id:uc03 epic:oss-scouting prio:high blocked:wg01
  Nail down what problem we're solving (voice feature? product angle?) before deciding how to borrow from either repo.
- [ ] Write findings summary and recommendation id:sm04 epic:oss-scouting prio:med blocked:vb02
  One-pager: what to borrow, what to build from scratch, next steps.
- [x] Wire OS Home to real vault data id:hr00 epic:home-real-data prio:high status:done
  Spec — Outcome: OS Home renders projects (and recent work / needs) from the real vault via buildBankData natively, not the inline SAMPLE DATA; the web preview keeps the grounded seed. States: loading (skeleton while the vault reads), empty (no projects → first-run "establish a project"), partial (projects but no recent work / needs), success, error (vault read fails → keep the seed + a quiet notice). Reversible: read-only; any failure falls back to the seed; no destructive step. Order/edges: initBank already re-renders after buildBankData — renderHome must read DATA.bank when present, else seed; the initial seed render → async swap race is handled by that re-render. Out of scope: real recent-work (artifacts) + needs-attention wiring, since bank-read doesn't produce those yet — projects first.
  - [ ] Map DATA.bank.projects → Home cards (jump-back-in + grid) id:hr01
  - [ ] renderHome reads DATA.bank when present, else seed id:hr02 blocked:hr01
  - [ ] Loading skeleton + empty / first-run state on Home id:hr03 blocked:hr02
  - [ ] Error path: vault read fails → keep seed + quiet notice id:hr04
  - [ ] Recent work / needs: derive from bank or keep seed behind a flag id:hr05 blocked:hr01
