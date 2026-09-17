# Bambu LAN adapter provenance

Reviewed source: https://github.com/DMontgomery40/bambu-printer-mcp

Pinned commit: `9e31502e55744f5962e2bb1472bf01732b03058a` (reviewed 2026-09-07).
The manifest at that commit identifies `bambu-printer-mcp` version **1.1.6** and **GPL-2.0**. The repository's README, redirects, package branding and release instructions are not used as installation authority. This integration does not execute upstream `npx`, install a moving release, or run its MCP server.

`LICENSE` retains the upstream license. `upstream/package.json` and `upstream/bambu.ts.source` retain the reviewed manifest and printer implementation for source correspondence. Breadboard's modified GPL adapter source is `dashboard/scripts/bambu-lan-adapter.mjs`; it and this directory are included in packaged app resources. Preserve this notice, license and corresponding adapter source when redistributing.

The local derivative separates upstream's combined `print3mf` into upload and start. It removes automatic filament matching, generic MQTT/G-code operations, deletion, heating, camera/ffmpeg, slicing, cloud authentication and client-certificate extraction. It uses the reviewed LAN MQTT/FTPS and `project_file` protocol shape, with exact approved plate/mapping/options. Unique remote `.3mf` filenames avoid upstream's `.gcode.3mf` branch that selects `gcode_file` and loses plate/mapping options. Local file hashes, remote file-length acknowledgement, bounded telemetry, identity freshness, retained-message rejection and passive-FTP target restriction were added. A publish acknowledgement is never treated as print completion or proof of start.

Transport dependencies are exact npm versions recorded with integrity in `dashboard/package-lock.json`: `mqtt@5.15.1` (MQTTjs/MQTT.js, MIT) and `basic-ftp@5.2.1` (patrickjuchli/basic-ftp, MIT). Their package licenses ship with their dependency trees. The initially reviewed upstream FTP version was not retained; the local adapter uses the patched 5.2.1 release. No change is made to the repository-wide licensing of unrelated code.

Printer photographs: `src/lib/bambu/photos.ts` deliberately maps supported models to an unavailable asset until a redistributable image is supplied. No Bambu marketing photograph is copied or hotlinked. The configured model always remains visible; the fallback is neutral. User-uploaded PNG/JPEG/WebP photos are re-encoded to local PNG without metadata. They remain the user's content. Test fixtures and screenshots are explicitly simulated and are not product photographs or real printer reports.

Local photo decoding uses the explicitly pinned `sharp@0.34.5` dependency (Apache-2.0), already available in the dashboard runtime. It is separate from printer networking and strips uploaded image metadata.
