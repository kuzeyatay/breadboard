# Bundled dashboard fonts

These unmodified fonts come from [google/fonts](https://github.com/google/fonts/tree/23e54b51ddffbc7713c583748e3bd86f62b1fa4a/ofl),
revision `23e54b51ddffbc7713c583748e3bd86f62b1fa4a`.
Each family directory includes its SIL Open Font License (`OFL.txt`).

The root layout and Pomodoro page use `next/font/local` so both fresh dashboard
builds and cached lean launches work without contacting Google Fonts. Keep these
files in source control; they are build inputs, not a downloaded runtime cache.
Next serves WOFF2 copies of the original TrueType files. Each copy contains the
full character set, weights, styles and layout tables. To reproduce a copy, run
`fonttools ttLib.woff2 compress --no-glyf-transform <original.ttf>` with Brotli installed.
