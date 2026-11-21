"""Run Doory for Breadboard on one loopback port: the built editor, the API, realtime and the MCP server.

    python serve.py --port 8796 --data <dir>

<dir> holds the SQLite database, uploads, the secret key, the per-launch ticket and Bread's MCP token
(`mcp-token`). Breadboard reads the last two; nothing else leaves the machine.
"""

from __future__ import annotations

import argparse
import mimetypes
import os
import secrets
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path[:0] = [str(HERE), str(ROOT / "backend")]

BREAD_EMAIL = "bread@breadboard.local"
TOKEN_NAME = "Bread (Breadboard)"
# Reports the editor's address to the Design page so Bread knows which design is open.
REPORTER = (
    b"<script>(function(){var last='';setInterval(function(){if(location.href!==last){last=location.href;"
    b"try{parent.postMessage({source:'doory',href:last},'*')}catch(e){}}},500)})()</script>"
)


def _secret(path: Path) -> str:
    if not path.exists():
        path.write_text(secrets.token_urlsafe(48), encoding="utf-8")
    return path.read_text(encoding="utf-8").strip()


def _browser() -> str:
    """Server-side export (export_design) drives an installed Chromium: Edge ships with Windows."""
    names = [r"Microsoft\Edge\Application\msedge.exe", r"Google\Chrome\Application\chrome.exe"]
    roots = [os.environ.get(k, "") for k in ("PROGRAMFILES(X86)", "PROGRAMFILES", "LOCALAPPDATA")]
    found = [Path(r, n) for n in names for r in roots if r and Path(r, n).is_file()]
    return str(found[0]) if found else ""


def configure(port: int, data: Path) -> None:
    data.mkdir(parents=True, exist_ok=True)
    (data / "media").mkdir(exist_ok=True)
    (data / "static").mkdir(exist_ok=True)
    ticket = secrets.token_urlsafe(32)
    (data / "ticket").write_text(ticket, encoding="utf-8")
    os.environ.update({
        "DJANGO_SETTINGS_MODULE": "bb_settings",
        "DJANGO_SECRET_KEY": _secret(data / "secret-key"),
        "DATABASE_URL": f"sqlite:///{(data / 'doory.sqlite3').as_posix()}",
        "MEDIA_ROOT": str(data / "media"),
        "MCP_ENABLED": "true",
        "SITE_URL": f"http://127.0.0.1:{port}",
        "DJANGO_ALLOWED_HOSTS": "127.0.0.1,localhost",
        "CSRF_TRUSTED_ORIGINS": f"http://127.0.0.1:{port},http://localhost:{port}",
        "CORS_ALLOWED_ORIGINS": f"http://127.0.0.1:{port},http://localhost:{port}",
        "BREADBOARD_DOORY_TICKET": ticket,
    })
    browser = os.environ.get("EXPORT_CHROMIUM_PATH") or _browser()
    os.environ["EXPORT_CHROMIUM_PATH"] = browser
    for gate in ("SERVER_PDF_ENABLED", "SERVER_IMAGE_EXPORT_ENABLED"):
        os.environ.setdefault(gate, "true" if browser else "false")


def bread_user():
    from django.contrib.auth import get_user_model

    users = get_user_model()
    user = users.objects.filter(email=BREAD_EMAIL).first()
    if user is None:
        user = users.objects.create_user(BREAD_EMAIL, None, display_name="Breadboard", is_email_verified=True)
    return user


def prepare(data: Path) -> None:
    """Migrate, then make sure Bread holds a live MCP token with every scope."""
    from django.core.management import call_command

    from apps.apitokens import services as tokens
    from apps.apitokens.scopes import SCOPES

    call_command("migrate", interactive=False, verbosity=0)
    user = bread_user()
    token_file = data / "mcp-token"
    current = token_file.read_text(encoding="utf-8").strip() if token_file.exists() else ""
    held = tokens.authenticate(current) if current else None
    if held is None or held.owner_id != user.pk or set(held.scopes) != set(SCOPES):
        for old in tokens.live_tokens(user).filter(name=TOKEN_NAME):
            tokens.revoke(old)
        issued = tokens.issue_token(user, name=TOKEN_NAME, scopes=list(SCOPES), expires_in_days=365)
        token_file.write_text(issued.plaintext, encoding="utf-8")


def build_app(data: Path):
    from doory.asgi import application as django_app
    from doory.mcp_asgi import application as mcp_app

    dist = ROOT / "frontend" / "dist"
    media = data / "media"
    django_prefixes = ("/api/", "/ws/", "/admin/", "/static/", "/__breadboard/", "/sitemap.xml")

    async def send_file(send, file: Path, cache: bool, sandbox: bool = False) -> None:
        body = file.read_bytes()
        if file.name == "index.html":
            body = body.replace(b"</head>", REPORTER + b"</head>", 1)
        kind = mimetypes.guess_type(file.name)[0] or "application/octet-stream"
        await send({"type": "http.response.start", "status": 200, "headers": [
            (b"content-type", kind.encode()), (b"content-length", str(len(body)).encode()),
            (b"cache-control", b"public, max-age=31536000, immutable" if cache else b"no-cache"),
            (b"x-content-type-options", b"nosniff"),
            # Uploads are user files (SVG can carry script): the same sandbox as deploy/nginx.conf.
            *([(b"content-security-policy", b"default-src 'none'; style-src 'unsafe-inline'; sandbox")]
              if sandbox else []),
        ]})
        await send({"type": "http.response.body", "body": body})

    def inside(base: Path, relative: str) -> Path | None:
        candidate = (base / relative).resolve()
        return candidate if candidate.is_file() and candidate.is_relative_to(base.resolve()) else None

    async def app(scope, receive, send):
        if scope["type"] == "lifespan":
            return await mcp_app(scope, receive, send)
        path = scope["path"]
        if path == "/mcp" or path.startswith("/mcp/"):
            return await mcp_app(scope, receive, send)
        if scope["type"] == "websocket" or path.startswith(django_prefixes):
            return await django_app(scope, receive, send)
        if path.startswith("/media/"):
            file = inside(media, path[len("/media/"):])
            if file:
                return await send_file(send, file, False, sandbox=True)
            return await django_app(scope, receive, send)
        file = inside(dist, path.lstrip("/")) if path != "/" else None
        # Every editor route is the single-page app.
        return await send_file(send, file or dist / "index.html", bool(file and "/assets/" in path))

    return app


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8796)
    parser.add_argument("--data", type=Path, required=True)
    args = parser.parse_args()
    configure(args.port, args.data)

    import django

    django.setup()
    prepare(args.data)
    import uvicorn

    uvicorn.run(build_app(args.data), host="127.0.0.1", port=args.port, log_level="warning",
                ws="auto", lifespan="on")


if __name__ == "__main__":
    main()
