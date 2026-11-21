"""`manage.py check` warnings for the OpenID Connect settings."""

from __future__ import annotations

from django.core.checks import Tags, Warning, register

from . import oidc


@register(Tags.security)
def check_oidc_settings(app_configs, **kwargs):
    return [
        Warning(
            f"{problem} OpenID Connect sign-in is off.",
            hint="See OpenID Connect sign-in in docs/self-hosting/configuration.md.",
            id="accounts.W001",
        )
        for problem in oidc.configuration_problems()
    ]
