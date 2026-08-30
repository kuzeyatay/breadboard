"""Tests for tiktok_tools.py."""

import asyncio
import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from tools.tiktok_tools import (
    is_tiktok_url,
    normalize_tiktok_url,
    unshorten_url_async,
    extract_tiktok_metadata_and_stream,
    download_tiktok_video,
)


class TestTikTokUrlDetection:
    def test_valid_tiktok_urls(self):
        assert is_tiktok_url("https://www.tiktok.com/@user/video/123456789") is True
        assert is_tiktok_url("https://tiktok.com/@user/video/123456789?param=1") is True
        assert is_tiktok_url("https://vm.tiktok.com/ZMhdq7e8x/") is True
        assert is_tiktok_url("https://vt.tiktok.com/ZS12345/") is True
        assert is_tiktok_url("https://m.tiktok.com/v/123.html") is True

    def test_invalid_tiktok_urls(self):
        assert is_tiktok_url("https://youtube.com/watch?v=123") is False
        assert is_tiktok_url("https://example.com") is False
        assert is_tiktok_url("not_a_url") is False
        assert is_tiktok_url("") is False


class TestTikTokExtractor:
    def _run(self, coro):
        return asyncio.run(coro)

    def test_extract_tiktok_tikwm_success(self):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "code": 0,
            "msg": "success",
            "data": {
                "title": "Test Title #fyp",
                "author": {"nickname": "TestUser", "unique_id": "testuser"},
                "hdplay": "https://cdn.tiktok.com/video/hd123.mp4",
                "play": "https://cdn.tiktok.com/video/123.mp4",
                "music_info": {"title": "Test Song", "author": "Test Artist"},
                "duration": 15,
                "play_count": 1000,
                "digg_count": 500,
                "comment_count": 50,
                "cover": "https://cdn.tiktok.com/cover/123.jpg",
            }
        }

        mock_client = MagicMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client.get = AsyncMock(return_value=mock_response)

        with patch("tools.url_safety.create_ssrf_safe_async_client", return_value=mock_client):
            with patch("tools.url_safety.async_is_safe_url", return_value=True):
                with patch("tools.website_policy.check_website_access", return_value=None):
                    res = self._run(extract_tiktok_metadata_and_stream("https://www.tiktok.com/@testuser/video/12345"))
                    assert res["success"] is True
                    assert res["title"] == "Test Title #fyp"
                    assert res["author"] == "TestUser"
                    assert res["author_username"] == "testuser"
                    assert res["video_url"] == "https://cdn.tiktok.com/video/hd123.mp4"
                    assert res["source"] == "tikwm"

    def test_extract_tiktok_ssstik_fallback(self):
        # Fail TikWM, succeed SSSTik
        mock_tikwm_resp = MagicMock()
        mock_tikwm_resp.status_code = 200
        mock_tikwm_resp.json.return_value = {"code": -1, "msg": "error"}

        mock_ssstik_resp = MagicMock()
        mock_ssstik_resp.status_code = 200
        mock_ssstik_resp.text = '<div id="mainpicture"><h2>CreatorName</h2><p class="maintext">Video caption</p><a href="https://tikcdn.io/ssstik/12345" class="download_link">Without watermark</a></div>'

        mock_client = MagicMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client.get = AsyncMock(return_value=mock_tikwm_resp)
        mock_client.post = AsyncMock(return_value=mock_ssstik_resp)

        with patch("tools.url_safety.create_ssrf_safe_async_client", return_value=mock_client):
            with patch("tools.url_safety.async_is_safe_url", return_value=True):
                with patch("tools.website_policy.check_website_access", return_value=None):
                    res = self._run(extract_tiktok_metadata_and_stream("https://www.tiktok.com/@user/video/12345"))
                    assert res["success"] is True
                    assert res["video_url"] == "https://tikcdn.io/ssstik/12345"
                    assert res["source"] == "ssstik"
                    assert res["author"] == "CreatorName"
                    assert res["title"] == "Video caption"

    def test_download_tiktok_video_flow(self, tmp_path):
        target = tmp_path / "test.mp4"
        meta_dict = {
            "success": True,
            "video_url": "https://cdn.example.com/play.mp4",
            "title": "Cool Video",
            "author": "Creator",
        }

        with patch("tools.tiktok_tools.extract_tiktok_metadata_and_stream", new_callable=AsyncMock, return_value=meta_dict):
            with patch("tools.vision_tools._download_video", new_callable=AsyncMock) as mock_dl:
                dest, meta = self._run(download_tiktok_video("https://www.tiktok.com/@user/video/123", target))
                assert dest == target
                assert meta["title"] == "Cool Video"
                mock_dl.assert_called_once_with("https://cdn.example.com/play.mp4", target, max_retries=3)
