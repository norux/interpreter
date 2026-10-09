# Coding conventions

- Use TypeScript with the existing strict compiler settings. Follow surrounding double quotes, semicolons and imports; Biome checks the repository.
- Prefer plain functions, narrow types and shallow control flow. Keep worker/feature helpers near their caller. Introduce shared abstractions only when independent callers need them.
- Keep browser globals in platform adapters. `packages/core` and `packages/contracts` must remain platform independent.
- Carry session identity, epoch and revision through asynchronous work. Reject stale results and release resources on cancellation, Stop and target loss.
- Bound audio, translation and transport queues. A normal burst of final results must preserve unread captions; do not silently reset the overlay to solve backpressure.
- Keep speaker inference independent of recognition and caption deadlines. Never upload voice embeddings or captured audio.
- Preserve visible text during correction. Use actual displayed text for reading acknowledgements and avoid rewriting unchanged DOM text.
- Add regression checks for bugs before fixing them. Test behavior rather than private implementation details; do not export helpers solely for tests.
- Keep feature changes scoped. Do not rename compatibility keys or reformat unrelated files as a side effect.
- Follow [AGENTS.md](../AGENTS.md)'s required README/AGENTS/docs review whenever behavior changes. Update support tables only when a platform is actually supported.
- Use Conventional Commits, with one intent per commit. Record verification and any meaningful limitations.
