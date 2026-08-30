"""Integration test for TikTok URL handling in video_analyze."""

import asyncio
import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

from tools.vision_tools import video_analyze_tool


class TestTikTokVideoAnalyzeIntegration:
    def _run(self, coro):
        return asyncio.run(coro)

    def test_tiktok_url_triggers_tiktok_downloader(self, tmp_path):
        tiktok_url = "https://www.tiktok.com/@helinelvereen/video/7646439191223487762"
        mock_meta = {
            "success": True,
            "title": "hocam lutfen #daha17",
            "author": "Helin",
            "author_username": "helinelvereen",
            "music_title": "original sound",
            "video_url": "https://v16.tiktokcdn.com/test.mp4",
        }

        captured_kwargs = {}
        async def fake_download(url, dest, **kwargs):
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(b"\x00\x00\x00 ftypisom" + b"\x00" * 100)
            return dest, mock_meta

        async def capture_llm(**kwargs):
            captured_kwargs.update(kwargs)
            mock_resp = MagicMock()
            mock_resp.choices = [MagicMock()]
            mock_resp.choices[0].message.content = "Analysis of the TikTok video"
            return mock_resp

        with patch("tools.tiktok_tools.download_tiktok_video", side_effect=fake_download) as mock_tt_dl:
            with patch("tools.vision_tools.async_call_llm", side_effect=capture_llm):
                with patch("tools.vision_tools.extract_content_or_reasoning", return_value="Analysis of the TikTok video"):
                    with patch("tools.url_safety.async_is_safe_url", return_value=True):
                        with patch("tools.website_policy.check_website_access", return_value=None):
                            res = self._run(video_analyze_tool(tiktok_url, "What is going on in this video?"))

        data = json.loads(res)
        assert data["success"] is True
        assert "Analysis of the TikTok video" in data["analysis"]
        assert mock_tt_dl.called

        # Ensure TikTok metadata (caption, creator, audio) was injected into prompt context
        messages = captured_kwargs.get("messages", [])
        prompt_text = messages[0]["content"][0]["text"]
        assert "hocam lutfen #daha17" in prompt_text
        assert "Helin" in prompt_text
        assert "original sound" in prompt_text
