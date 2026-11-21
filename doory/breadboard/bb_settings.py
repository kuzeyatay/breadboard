"""Doory settings when Breadboard runs it on loopback (see serve.py). Upstream files stay untouched."""

from doory.settings.base import *  # noqa: F403

DEBUG = False
ROOT_URLCONF = "bb_urls"
# One local user on loopback: the editor is framed by Breadboard's Design page.
X_FRAME_OPTIONS = "SAMEORIGIN"
SECURE_CROSS_ORIGIN_OPENER_POLICY = None
SESSION_COOKIE_SECURE = False
CSRF_COOKIE_SECURE = False
# Admin templates only; a manifest would need collectstatic first.
STORAGES = {**STORAGES, "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"}}  # noqa: F405
STATIC_ROOT = MEDIA_ROOT.parent / "static"  # noqa: F405
