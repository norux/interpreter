# Jamak mark

The mark is a subtitle speech bubble with two eyes and two caption lines on an indigo rounded tile. It is a deterministic SVG designed for small extension sizes, not an AI-generated bitmap.

- Source and README mark: [`jamak.svg`](../../apps/chrome/public/icons/jamak.svg)
- Chrome toolbar/extension assets: `icon-16.png`, `icon-32.png`, `icon-48.png`, `icon-128.png` beside the source.
- Popup and reference host use the same SVG.

Regenerate PNGs after editing the SVG:

```sh
node scripts/build-icons.mjs
```

The renderer uses Playwright Chromium at device scale 1 and preserves transparency outside the tile. Verify the mark at 16 px and on both light and dark backgrounds.
