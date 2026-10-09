# Jamak Chrome transition — 2026-10-09

The shipping application is now `apps/chrome`. Removed the legacy extension, Python server, macOS companion, their adapter/tests/dependencies and companion installer workflow. Existing model cache and transport keys retain their internal prefix. GitHub/public branding is Jamak.

Verified after the transition:

- `npm run verify`: Biome, both type-check layers, default Chrome build, 156 unit/fixture tests and the controlled-clock caption stability check passed.
- `node tests/framework-chrome-popup.mjs`: popup browser/API-mock check passed. This does not verify native model availability.
- `npm run test:framework:chrome:overlay`: six unit tests and the real extension-port/layout/fullscreen/Stop browser check passed. Caption inputs are synthetic; this does not rerun recognition/translation accuracy.
- Built manifest assets exist; every declared icon PNG has its declared square dimensions (16/32/48/128). Inspected the 128 px mark; the same SVG appears in popup/README.
- `git diff --check`: passed.

The earlier real ~58-second conversation and WeSpeaker results are recorded in [speaker/caption verification](captions/conversation-speakers.md). They were not rerun solely for the branding/removal change. Local transition logs are ignored under `.ralph/jamak-*.log`.

README, AGENTS.md and the current architecture/convention/testing documentation were updated together. Old verification reports remain historical evidence. The application and brand assets use MIT, as selected by the owner; model licenses remain documented independently.
