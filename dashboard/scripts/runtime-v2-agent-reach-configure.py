"""Write one closed-registry Agent Reach credential from a sealed Runtime file."""

from __future__ import annotations

import os
import stat
import sys
from pathlib import Path

MAX_SECRET_BYTES = 64 * 1024
MAX_SECRET_CHARS = 20_000
SUPPORTED_KEYS = {
    "proxy",
    "github-token",
    "groq-key",
    "openai-key",
    "twitter-cookies",
    "youtube-cookies",
    "xhs-cookies",
}
SUPPORTED_BROWSERS = {"chrome", "edge", "firefox", "brave", "opera"}
SUPPORTED_PLATFORMS = {"bilibili", "xueqiu"}


def _read_secret(candidate: str) -> str:
    path = Path(candidate)
    if not path.is_absolute():
        raise ValueError("The sealed credential path is not absolute.")
    metadata = path.lstat()
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
        raise ValueError("The sealed credential is not a direct regular file.")
    if metadata.st_size < 1 or metadata.st_size > MAX_SECRET_BYTES:
        raise ValueError("The sealed credential exceeded its bound.")
    with path.open("rb") as handle:
        payload = handle.read(MAX_SECRET_BYTES + 1)
    if len(payload) != metadata.st_size or len(payload) > MAX_SECRET_BYTES:
        raise ValueError("The sealed credential changed while it was read.")
    value = payload.decode("utf-8").strip()
    if not value:
        raise ValueError("The credential is empty.")
    if len(value) > MAX_SECRET_CHARS or any(ord(character) == 0 for character in value):
        raise ValueError("The credential exceeded its bound.")
    return value


def _configure(key: str, value: str) -> str:
    from agent_reach.config import Config

    config = Config()
    if key == "proxy":
        config.set("proxy", value)
        config.set("bilibili_proxy", value)
        return "The Agent Reach proxy setting was saved."
    if key == "github-token":
        config.set("github_token", value)
        return "The GitHub token was saved."
    if key == "groq-key":
        config.set("groq_api_key", value)
        return "The Groq key was saved."
    if key == "openai-key":
        config.set("openai_api_key", value)
        return "The OpenAI key was saved."
    if key == "youtube-cookies":
        config.set("youtube_cookies_from", value)
        return "The YouTube cookie source was saved."
    if key == "twitter-cookies":
        from agent_reach.cli import _parse_twitter_cookie_input

        auth_token, ct0 = _parse_twitter_cookie_input(value)
        if not auth_token or not ct0:
            raise ValueError("The Twitter cookie export did not contain auth_token and ct0.")
        config.set("twitter_auth_token", auth_token)
        config.set("twitter_ct0", ct0)
        return "The Twitter cookies were saved."
    if key == "xhs-cookies":
        from agent_reach.cli import _configure_xhs_cookies

        if not _configure_xhs_cookies(value):
            raise ValueError("The XiaoHongShu cookie export could not be configured.")
        return "The XiaoHongShu cookies were saved."
    raise ValueError("The credential key is unsupported.")


def _import_cookies(browser: str, platform: str) -> str:
    from agent_reach.config import Config
    from agent_reach.cookie_extract import configure_from_browser

    config_path = os.environ.get("AGENT_REACH_CONFIG_PATH", "").strip()
    if not config_path or not Path(config_path).is_absolute():
        raise ValueError("The private Agent Reach config path is unavailable.")
    results = configure_from_browser(
        browser,
        Config(config_path=Path(config_path)),
        platform=platform,
    )
    def succeeded(result: object) -> bool:
        if hasattr(result, "success"):
            return bool(getattr(result, "success"))
        return bool(result[1])  # type: ignore[index]

    if not any(succeeded(result) for result in results):
        raise ValueError("No matching cookies were found in that browser profile.")
    return f"Imported {platform} cookies from {browser}."


def main() -> int:
    try:
        if len(sys.argv) == 4 and sys.argv[1] == "configure" and sys.argv[2] in SUPPORTED_KEYS:
            value = _read_secret(sys.argv[3])
            print(_configure(sys.argv[2], value))
        elif (
            len(sys.argv) == 4
            and sys.argv[1] == "import-cookies"
            and sys.argv[2] in SUPPORTED_BROWSERS
            and sys.argv[3] in SUPPORTED_PLATFORMS
        ):
            print(_import_cookies(sys.argv[2], sys.argv[3]))
        else:
            print("The Agent Reach configuration request is invalid.", file=sys.stderr)
            return 2
        return 0
    except Exception as error:  # No secret values are ever interpolated here.
        message = str(error).strip() or "The Agent Reach credential could not be saved."
        print(message[:4_000], file=sys.stderr)
        return 1


if __name__ == "__main__":
    # The Runtime profile supplies a data-root HOME; never inherit a developer
    # home implicitly if central registration is incomplete.
    if not os.environ.get("HOME"):
        print("The Agent Reach private home is unavailable.", file=sys.stderr)
        raise SystemExit(2)
    raise SystemExit(main())
