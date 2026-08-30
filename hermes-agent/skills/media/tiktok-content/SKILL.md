---
name: tiktok-content
description: "Download TikTok videos, extract metadata/captions, and analyze TikTok content."
platforms: [linux, macos, windows]
---

# TikTok Content & Video Downloader

## When to use

Use when the user shares a TikTok URL (`tiktok.com`, `vm.tiktok.com`, `vt.tiktok.com`), asks what is happening in a TikTok video, requests a summary or transcript of a TikTok, or wants to download/inspect a TikTok video without anti-bot blockage.

## Capabilities

- **Bypass TikTok Anti-Bot Blocks**: Downloads watermark-free HD MP4 video streams directly from TikTok CDNs using resilient scrapers/APIs (TikWM, SSSTik).
- **Metadata & Audio Extraction**: Retrieves title, caption, hashtags, creator nickname/username, music/audio track title, view count, like count, comment count, and duration.
- **Multimodal Video Understanding**: Plugs into `video_analyze` to give visual and audio understanding directly to the agent.

## Helper Script

The helper script extracts metadata and downloads TikTok MP4 videos:

```bash
# Extract metadata (JSON format)
python hermes-agent/skills/media/tiktok-content/scripts/fetch_tiktok.py "https://www.tiktok.com/@username/video/1234567890"

# Download the video (.mp4)
python hermes-agent/skills/media/tiktok-content/scripts/fetch_tiktok.py "https://www.tiktok.com/@username/video/1234567890" --download --output-dir ./
```

## Direct Python API

```python
from tools.tiktok_tools import extract_tiktok_metadata_and_stream, download_tiktok_video

# Extract info
info = await extract_tiktok_metadata_and_stream("https://www.tiktok.com/@user/video/123")

# Download MP4
video_path, info = await download_tiktok_video("https://www.tiktok.com/@user/video/123", destination_path)
```

## Workflow for "What is going on in this TikTok video?"

1. **Direct Video Analysis**: When the user provides a TikTok URL, `video_analyze` automatically recognizes TikTok URLs, retrieves the direct video stream and caption/audio context, and analyzes the video with multimodal vision.
2. **Fallback Analysis**: If `video_analyze` model is unavailable, run `fetch_tiktok.py` to get the caption, tags, creator, sound title, and stats to provide an accurate overview of the post.
