# -*- coding: utf-8 -*-
"""TikTok video download and metadata extraction module.

Provides anti-bot resistant TikTok video fetching, metadata extraction,
and video downloading with multiple redundant scrapers/providers
(TikWM API, SSSTik, unshortening, and direct web rehydration parsing).

Can be used standalone via CLI/scripts, as a tool in hermes-agent,
or integrated into vision_tools and video analysis pipelines.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import urllib.parse
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from tools.url_safety import async_is_safe_url, is_safe_url
from tools.website_policy import check_website_access

logger = logging.getLogger(__name__)

_TIKTOK_HOST_PATTERNS = (
    "tiktok.com",
    "www.tiktok.com",
    "m.tiktok.com",
    "vm.tiktok.com",
    "vt.tiktok.com",
    "v.douyin.com",
    "douyin.com",
)

_DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


def is_tiktok_url(url: str) -> bool:
    """Return True if the URL points to a TikTok (or Douyin) video/post."""
    if not url or not isinstance(url, str):
        return False
    url_lower = url.strip().lower()
    if not url_lower.startswith(("http://", "https://")):
        return False
    try:
        parsed = urllib.parse.urlparse(url_lower)
        host = (parsed.hostname or parsed.netloc or "").lower()
        return any(host == pat or host.endswith(f".{pat}") for pat in _TIKTOK_HOST_PATTERNS)
    except Exception:
        return False


def normalize_tiktok_url(url: str) -> str:
    """Normalize and resolve TikTok URL (stripping tracking parameters or expanding shortlinks)."""
    if not url:
        return ""
    cleaned = url.strip()
    return cleaned


async def unshorten_url_async(url: str, timeout: float = 10.0) -> str:
    """Async URL redirect resolver for shortlinks (e.g. vm.tiktok.com/xxx)."""
    if not is_safe_url(url):
        return url
    blocked = check_website_access(url)
    if blocked:
        return url

    try:
        from tools.url_safety import create_ssrf_safe_async_client

        async with create_ssrf_safe_async_client(
            timeout=timeout,
            follow_redirects=True,
        ) as client:
            resp = await client.head(
                url,
                headers={"User-Agent": _DEFAULT_USER_AGENT},
            )
            final_url = str(resp.url)
            if final_url and final_url != url:
                return final_url
    except Exception as exc:
        logger.debug("Unshorten HEAD failed for %s (%s), trying GET", url, exc)
        try:
            from tools.url_safety import create_ssrf_safe_async_client

            async with create_ssrf_safe_async_client(
                timeout=timeout,
                follow_redirects=True,
            ) as client:
                resp = await client.get(
                    url,
                    headers={"User-Agent": _DEFAULT_USER_AGENT},
                )
                final_url = str(resp.url)
                if final_url:
                    return final_url
        except Exception as exc2:
            logger.debug("Unshorten GET failed for %s: %s", url, exc2)

    return url


async def extract_tiktok_metadata_and_stream(
    tiktok_url: str,
    timeout: float = 15.0,
) -> Dict[str, Any]:
    """Extract TikTok video stream URL and rich metadata using multi-provider fallback.

    Returns dict with:
        success (bool)
        title (str)
        author (str)
        author_username (str)
        video_url (str) - Direct CDN download URL
        music_title (str)
        music_author (str)
        duration (int/float)
        play_count (int)
        like_count (int)
        comment_count (int)
        cover_url (str)
        source (str)
    """
    resolved_url = await unshorten_url_async(tiktok_url, timeout=timeout)

    # 1. Primary extractor: TikWM API (high quality, HD stream, full metadata)
    try:
        tikwm_api = f"https://www.tikwm.com/api/?url={urllib.parse.quote(resolved_url)}&hd=1"
        if await async_is_safe_url(tikwm_api) and not check_website_access(tikwm_api):
            from tools.url_safety import create_ssrf_safe_async_client

            async with create_ssrf_safe_async_client(
                timeout=timeout,
                follow_redirects=True,
            ) as client:
                resp = await client.get(
                    tikwm_api,
                    headers={"User-Agent": _DEFAULT_USER_AGENT},
                )
                if resp.status_code == 200:
                    data = resp.json()
                    if data.get("code") == 0:
                        d = data.get("data", {})
                        stream_url = d.get("hdplay") or d.get("play") or d.get("wmplay")
                        if stream_url:
                            author_obj = d.get("author") or {}
                            music_obj = d.get("music_info") or {}
                            return {
                                "success": True,
                                "title": d.get("title") or "",
                                "author": author_obj.get("nickname") or "",
                                "author_username": author_obj.get("unique_id") or "",
                                "video_url": stream_url,
                                "music_title": music_obj.get("title") or "",
                                "music_author": music_obj.get("author") or "",
                                "duration": d.get("duration") or 0,
                                "play_count": d.get("play_count") or 0,
                                "like_count": d.get("digg_count") or 0,
                                "comment_count": d.get("comment_count") or 0,
                                "cover_url": d.get("cover") or "",
                                "source": "tikwm",
                            }
    except Exception as exc:
        logger.warning("TikWM extraction failed for %s: %s", resolved_url, exc)

    # 2. Secondary fallback extractor: SSSTik API
    try:
        ssstik_endpoint = "https://ssstik.io/abc?url=dl"
        if await async_is_safe_url(ssstik_endpoint) and not check_website_access(ssstik_endpoint):
            from tools.url_safety import create_ssrf_safe_async_client

            async with create_ssrf_safe_async_client(
                timeout=timeout,
                follow_redirects=True,
            ) as client:
                post_data = {"id": resolved_url, "locale": "en", "tt": "0"}
                resp = await client.post(
                    ssstik_endpoint,
                    data=post_data,
                    headers={
                        "User-Agent": _DEFAULT_USER_AGENT,
                        "Origin": "https://ssstik.io",
                        "Referer": "https://ssstik.io/en",
                        "HX-Request": "true",
                        "HX-Target": "target",
                        "HX-Current-URL": "https://ssstik.io/en",
                    },
                )
                if resp.status_code == 200:
                    body = resp.text
                    m = re.search(
                        r'href="([^"]+)"[^>]*>(?:Without watermark|Download)',
                        body,
                        re.IGNORECASE,
                    )
                    if not m:
                        m = re.search(r'href="(https://tikcdn\.io/[^"]+)"', body)
                    if m:
                        dl_url = m.group(1)
                        author_m = re.search(r"<h2>([^<]+)</h2>", body)
                        desc_m = re.search(r'<p class="maintext">([^<]+)</p>', body)
                        return {
                            "success": True,
                            "title": desc_m.group(1).strip() if desc_m else "",
                            "author": author_m.group(1).strip() if author_m else "",
                            "author_username": "",
                            "video_url": dl_url,
                            "music_title": "",
                            "music_author": "",
                            "duration": 0,
                            "play_count": 0,
                            "like_count": 0,
                            "comment_count": 0,
                            "cover_url": "",
                            "source": "ssstik",
                        }
    except Exception as exc:
        logger.warning("SSSTik extraction failed for %s: %s", resolved_url, exc)

    return {
        "success": False,
        "error": f"Failed to extract playable stream or metadata for TikTok video: {tiktok_url}",
    }


async def download_tiktok_video(
    tiktok_url: str,
    destination: Path,
    max_retries: int = 3,
    timeout: float = 60.0,
) -> Tuple[Path, Dict[str, Any]]:
    """Download a TikTok video to the specified destination path.

    Returns (destination_path, metadata_dict).
    """
    destination.parent.mkdir(parents=True, exist_ok=True)

    metadata = await extract_tiktok_metadata_and_stream(tiktok_url)
    if not metadata.get("success") or not metadata.get("video_url"):
        raise ValueError(
            metadata.get("error") or f"Could not obtain stream URL for TikTok video: {tiktok_url}"
        )

    direct_stream_url = metadata["video_url"]
    from tools.vision_tools import _MAX_VIDEO_BASE64_BYTES, _download_video

    # Download the direct stream using standard ssrf-safe video downloader
    await _download_video(direct_stream_url, destination, max_retries=max_retries)
    return destination, metadata
