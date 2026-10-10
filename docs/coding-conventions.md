# Coding conventions

- Use TypeScript with the existing strict compiler settings. Follow surrounding double quotes, semicolons and imports; Biome checks the repository.
- Prefer plain functions, narrow types and shallow control flow. Keep worker/feature helpers near their caller. Introduce shared abstractions only when independent callers need them.
- In automatic sessions, route translation by each transcript revision’s detected language. Never emit `auto` as a transcript language, infer language solely from a speaker ID, or pass Korean originals through native translation.
- Keep recognition/translation settings independent and frozen per preparation. Download-on-selection must dispose the previous session, preserve completed caches and never initiate tab capture. Explicit model/backend errors must not silently fall back.
- Keep browser globals in platform adapters. `packages/core` and `packages/contracts` must remain platform independent.
- Carry session identity, epoch and revision through asynchronous work. Reject stale results and release resources on cancellation, Stop and target loss.
- Bound audio, translation and transport queues. A normal burst of final results must preserve unread captions; do not silently reset the overlay to solve backpressure.
- Keep speaker inference independent of recognition and caption deadlines. Never upload voice embeddings or captured audio.
- Measure and acknowledge each stacked caption independently. Only fully visible rows accrue reading time; removing an older row must not restart a newer row’s clock.
- Preserve visible text during correction. Use actual displayed text for reading acknowledgements and avoid rewriting unchanged DOM text.
- Retire a row only after its latest source and matching translation are final and read. Newer captions must not expire provisional rows; pending corrections must hold even a previously final displayed pair and grant final reading time when the corrected pair arrives.
- Explicitly withdraw provisional hypotheses removed by recognition corrections. Carry a newer final empty `retracted` revision through the existing source channel, remove it from overlay/history, and fence late replies. Do not invent final text or age out an active correction to unblock the stack.
- Add regression checks for bugs before fixing them. Test behavior rather than private implementation details; do not export helpers solely for tests.
- Keep feature changes scoped. Do not rename compatibility keys or reformat unrelated files as a side effect.
- Follow [AGENTS.md](../AGENTS.md)'s required README/AGENTS/docs review whenever behavior changes. Update support tables only when a platform is actually supported.
- Use Conventional Commits, with one intent per commit. Record verification and any meaningful limitations.
