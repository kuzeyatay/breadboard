#!/usr/bin/env python3
"""
Fetch TikTok video metadata and optionally download video / audio.

Usage:
    python fetch_tiktok.py <tiktok_url> [--download] [--output-dir ./] [--json]

Output (JSON):
    {
        "title": "...",
        "author": "...",
        "author_username": "...",
        "duration": 15,
        "video_url": "...",
        "music_title": "...",
        "play_count": 100000,
        "like_count": 5000,
        "downloaded_file": "/path/to/tiktok_video.mp4"
    }
"""

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

# Add hermes-agent root to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent.parent))

from tools.tiktok_tools import extract_tiktok_metadata_and_stream, download_tiktok_video, is_tiktok_url


async def run():
    parser = argparse.ArgumentParser(description="Fetch TikTok video metadata and video file")
    parser.add_argument("url", help="TikTok video URL (desktop, mobile, or shortlink)")
    parser.add_argument("--download", "-d", action="store_true", help="Download the video file (.mp4)")
    parser.add_argument("--output-dir", "-o", default=".", help="Output directory for downloaded video")
    parser.add_argument("--json", "-j", action="store_true", default=True, help="Output formatted JSON")
    args = parser.parse_args()

    url = args.url.strip()
    if not is_tiktok_url(url):
        print(json.dumps({"success": False, "error": f"Invalid TikTok URL: {url}"}))
        sys.exit(1)

    try:
        if args.download:
            out_dir = Path(args.output_dir).expanduser().resolve()
            out_dir.mkdir(parents=True, exist_ok=True)
            meta = await extract_tiktok_metadata_and_stream(url)
            if not meta.get("success"):
                print(json.dumps(meta))
                sys.exit(1)
            clean_id = "".join(c for c in (meta.get("author_username") or "video") if c.isalnum())
            target_file = out_dir / f"tiktok_{clean_id}_{meta.get('duration', 0)}s.mp4"
            dest, _ = await download_tiktok_video(url, target_file)
            meta["downloaded_file"] = str(dest)
            print(json.dumps(meta, indent=2, ensure_ascii=False))
        else:
            meta = await extract_tiktok_metadata_and_stream(url)
            print(json.dumps(meta, indent=2, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)


def main():
    asyncio.run(run())


if __name__ == "__main__":
    main()
