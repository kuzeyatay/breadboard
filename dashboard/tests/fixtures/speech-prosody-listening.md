# Speech delivery listening checks

The companion `speech-prosody.json` contains 15 authored passages, exact prepared
scripts, and a listening focus for each. These are regression examples, not
recordings of the user's reported failures.

Use the existing Voice settings preview with the same provider, voice, model,
and language for both versions. Paste each `text` value into the preview. The
preview now uses the same Markdown-to-speech preparation as response playback.
Save baseline and candidate audio separately when comparing builds. Repeat each
sample three times; generated delivery can vary even with the same text.

For each pair, conceal which version is which and record:

- Which reading has more natural emphasis and pauses (A, B, or tie).
- Any incorrect, missing, repeated, or added words, with the time in the clip.
- Pronunciation errors and changes in pace across the reading.
- Time from Play to the first audible word and total reading duration.

Also concatenate the prose samples into a long response to check chunk joins.
Stop in the middle and immediately start another reading: old audio must not
resume. Compare response playback and the MP3 download on the same passage.

For pronunciation checks, save `SQL = sequel` and `API = A P I`. Confirm that
`APIs` stays unchanged, that the written message stays unchanged, and that an
active voice conversation uses the new rules after reconnecting. Delete the
rules and check the original pronunciation again.

Keep delivery changes only when most non-tied comparisons prefer them, no words
are lost or added, and startup latency remains acceptable. Automated tests
verify text, request routing, limits, cancellation, and settings persistence;
they do not measure perceived voice quality. Live provider A/B recordings have
not been made by this test suite.
