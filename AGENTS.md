# Jamak agent harness

Jamak is a desktop Chrome extension for on-device live Korean subtitles. `apps/chrome` is the only shipping application. iPhone Safari and a macOS app are planned, not implemented. Do not recreate the removed server or companion app without an explicit request.

## Read before editing

- [Documentation index](docs/README.md)
- [Architecture and runtime boundaries](docs/architecture/media-framework.md)
- [Coding conventions](docs/coding-conventions.md)
- [Verification and local fixtures](docs/testing.md)

Read the relevant feature verification document when changing recognition, translation, speaker assignment or caption lifecycle.

## Scope and implementation

State assumptions and observable success criteria before coding. Preserve the existing architecture and use the smallest change that satisfies the request. Establish a failing regression check for bugs. Keep unrelated changes out. Internal channel names, CSS selectors and model cache keys may retain the old `interpreter` prefix for compatibility; user-facing branding is Jamak.

Never commit credentials, model weights, user recordings, `.ralph` output or OS metadata. Synthetic, reproducible test fixtures belong in `tests/fixtures`.

## Documentation synchronization — required for feature changes

Whenever a feature is added, removed or modified, review and update all of the following in the same change:

1. `README.md`: supported capabilities, installation, limitations and platform status.
2. `AGENTS.md`: agent workflow, application scope and invariants affected by the feature.
3. `docs/`: architecture, coding conventions and verification instructions or evidence affected by the feature.

Make concrete edits wherever the behavior or instructions changed. If a document remains accurate, explicitly report that it was reviewed and why no edit was needed. Do not add meaningless edits just to touch a file. Do not mark the work complete while documentation contradicts implementation, or present planned platforms as supported.

## Verification and delivery

Run `npm run verify` for broad changes. For a scoped change, run the checks listed in `docs/testing.md` that demonstrate its behavior. Distinguish mocked display tests from real audio/model/browser verification. Report commands, failures and environment limitations honestly.

Use Conventional Commits with one intent per commit. Push, publish, rename a remote repository or modify external settings only when the user has authorized the action.
