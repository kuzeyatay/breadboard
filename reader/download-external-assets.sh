#!/usr/bin/env bash
# Downloads external (non-redistributable) artifacts into ./licensed/. Run via
# `npm run assets:download` (or `bash ./download-external-assets.sh`).
# Idempotent: existing files are skipped unless FORCE_DOWNLOAD_EXTERNAL=1 is set.
# Set SKIP_DOWNLOAD_EXTERNAL=1 to bypass.

set -u

if [ "${SKIP_DOWNLOAD_EXTERNAL:-}" ]; then
    echo "[download-external] SKIP_DOWNLOAD_EXTERNAL set, skipping."
    exit 0
fi

cd "$(dirname "$0")"
mkdir -p licensed

ARTIFACTS=(
    "GeoLite2-City.mmdb|https://raw.githubusercontent.com/P3TERX/GeoLite.mmdb/download/GeoLite2-City.mmdb"
    "geolite2-asn.mmdb|https://cdn.jsdelivr.net/npm/@ip-location-db/geolite2-asn-mmdb/geolite2-asn.mmdb"
    "SourceHanSansSC-Regular.otf|https://raw.githubusercontent.com/adobe-fonts/source-han-sans/refs/heads/release/OTF/SimplifiedChinese/SourceHanSansSC-Regular.otf"
    "gsa_useragents.txt|https://raw.githubusercontent.com/searxng/searxng/refs/heads/master/searx/data/gsa_useragents.txt"
)

failed=0
for entry in "${ARTIFACTS[@]}"; do
    name="${entry%%|*}"
    url="${entry#*|}"
    dest="licensed/$name"

    if [ -z "${FORCE_DOWNLOAD_EXTERNAL:-}" ] && [ -s "$dest" ]; then
        echo "[download-external] skip $name (already present)"
        continue
    fi

    echo "[download-external] get  $name"
    if curl -fsSL --retry 3 --retry-delay 2 -o "$dest.partial" "$url"; then
        mv "$dest.partial" "$dest"
    else
        rm -f "$dest.partial"
        echo "[download-external] failed $name" >&2
        failed=$((failed + 1))
    fi
done

if [ "$failed" -gt 0 ]; then
    echo "[download-external] $failed artifact(s) failed; \`npm run build\` will fail until they are present. Re-run with FORCE_DOWNLOAD_EXTERNAL=1 npm run assets:download." >&2
fi

# Don't fail npm install on transient network issues.
exit 0
