# Handwrite integration

Source: https://github.com/yashlamba/handwrite
Pinned revision: `4380f15e46da1f7b535b6b608e1ceb30ada9381a` (MIT, see LICENSE).

The original 80-cell PDF template is distributed at
`quartz/quartz/static/handwrite/template.pdf`. `default.json` is unchanged upstream
configuration; the filled-sheet test fixture also comes from that revision.

Breadboard adapts Handwrite's sheet → glyph crops → Potrace outlines → font
pipeline to an offline browser worker. Grid detection uses connected rectangular
components with the same threshold, 8 × 10 ordering and 7/16 crop margin.
Potrace's JavaScript port traces the glyphs. The existing OpenType.js dependency
writes the font instead of requiring users to install FontForge. Glyph metrics
are normalized by character class for readable baselines and punctuation.

Samples stay in the browser. The generated OpenType font and preferences are
stored in Quartz's IndexedDB on this device, never in published Markdown.
Font export/import allows transfer or backup across devices or browser profiles.

The worker bundles `potrace` 2.1.8 (GPL-2.0) and `opentype.js` 2.0.0 (MIT).
Their license texts are distributed beside the template. The browser bitmap
adapter replaces only Jimp's image loading; it performs no network/file access.
