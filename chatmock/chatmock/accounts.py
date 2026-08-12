from __future__ import annotations

"""Multiple ChatGPT accounts, with the exhausted ones stepped over.

A ChatGPT plan's weekly Codex window can run out for days. One account then
blocks every subsystem, even when another signed-in account still has headroom.

Accounts are ordered and selection is **sticky**: the first healthy one serves
every request until it reports exhaustion, at which point it goes on cooldown
and the next takes over. Rotating per request would spread load more evenly but
would also change `prompt_cache_key` ownership on every turn, throwing away the
prompt caching that makes long agent runs affordable — a worse trade than
occasional imbalance.

Layout, all in ChatMock's home directory:

    auth.json              the primary account (unchanged, still written by login)
    accounts/<name>.json   additional accounts, same shape

Nothing here refreshes tokens; `utils.load_chatgpt_tokens` still owns that, and
is handed the specific file this module selected.
"""

import glob
import os
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from . import failover
from .utils import _read_auth_path, get_home_dir, parse_jwt_claims

ACCOUNTS_DIRNAME = "accounts"

#: Cooldown keys are namespaced so an account and a model cannot collide.
COOLDOWN_PREFIX = "chatgpt-account:"


@dataclass(frozen=True)
class ChatGptAccount:
    """One signed-in ChatGPT account."""

    key: str
    path: str
    auth: Dict[str, Any]
    email: Optional[str]
    plan: Optional[str]
    #: True for the account in `auth.json`, which login keeps writing to.
    primary: bool

    @property
    def cooldown_key(self) -> str:
        return f"{COOLDOWN_PREFIX}{self.key}"

    @property
    def label(self) -> str:
        return self.email or self.key


def accounts_dir() -> str:
    return os.path.join(get_home_dir(), ACCOUNTS_DIRNAME)


def _claims(auth: Dict[str, Any]) -> Dict[str, Any]:
    tokens = auth.get("tokens") if isinstance(auth.get("tokens"), dict) else {}
    id_token = tokens.get("id_token")
    return parse_jwt_claims(id_token) if isinstance(id_token, str) else {} or {}


def _identity(auth: Dict[str, Any], path: str) -> tuple[str, Optional[str], Optional[str]]:
    """A stable key plus the descriptive bits, from the id token when present."""
    claims = _claims(auth) or {}
    auth_claims = claims.get("https://api.openai.com/auth")
    auth_claims = auth_claims if isinstance(auth_claims, dict) else {}

    email = claims.get("email") if isinstance(claims.get("email"), str) else None
    plan = (
        auth_claims.get("chatgpt_plan_type")
        if isinstance(auth_claims.get("chatgpt_plan_type"), str)
        else None
    )

    tokens = auth.get("tokens") if isinstance(auth.get("tokens"), dict) else {}
    key = (
        tokens.get("account_id")
        or auth_claims.get("chatgpt_account_id")
        or email
        # Last resort: the filename, which is at least stable on disk.
        or os.path.splitext(os.path.basename(path))[0]
    )
    return str(key), email, plan


def _primary_path() -> str:
    return os.path.join(get_home_dir(), "auth.json")


def list_accounts() -> List[ChatGptAccount]:
    """Every signed-in account, primary first, then additions by filename."""
    found: List[ChatGptAccount] = []
    seen: set[str] = set()

    def add(path: str, primary: bool) -> None:
        auth = _read_auth_path(path)
        if auth is None:
            return
        key, email, plan = _identity(auth, path)
        if key in seen:
            return
        seen.add(key)
        found.append(
            ChatGptAccount(key=key, path=path, auth=auth, email=email, plan=plan, primary=primary)
        )

    add(_primary_path(), True)
    for path in sorted(glob.glob(os.path.join(accounts_dir(), "*.json"))):
        add(path, False)
    return found


def healthy_accounts() -> List[ChatGptAccount]:
    return [account for account in list_accounts() if not failover.is_cooling(account.cooldown_key)]


def select_account() -> Optional[ChatGptAccount]:
    """The account requests should use: the first that is not exhausted.

    When every account is cooling, the first is returned anyway — the caller
    still needs credentials to produce a meaningful upstream error, and the
    model-level failover above it is what moves traffic to another provider.
    """
    accounts = list_accounts()
    if not accounts:
        return None
    for account in accounts:
        if not failover.is_cooling(account.cooldown_key):
            return account
    return accounts[0]


def note_account_exhausted(key: str, *, reason: str = "", seconds: int | None = None) -> None:
    """Put one account on cooldown so the next request uses a sibling."""
    if not key:
        return
    failover.note_exhausted(f"{COOLDOWN_PREFIX}{key}", reason=reason, seconds=seconds)


def account_state() -> List[Dict[str, Any]]:
    """Redacted account list for the management API. Never includes a token."""
    state: List[Dict[str, Any]] = []
    for account in list_accounts():
        cooldown = failover.cooldown_for(account.cooldown_key)
        state.append(
            {
                "key": account.key,
                "email": account.email,
                "plan": account.plan,
                "primary": account.primary,
                "path": account.path,
                "available": cooldown is None,
                "cooldownSeconds": cooldown.remaining_seconds if cooldown else 0,
                "cooldownReason": cooldown.reason if cooldown else None,
            }
        )
    return state


def add_account_path(label: str) -> str:
    """Where a newly added (non-primary) account should be written."""
    safe = "".join(char for char in label if char.isalnum() or char in "-_.@") or "account"
    return os.path.join(accounts_dir(), f"{safe}.json")


def preserve_current_account() -> Optional[ChatGptAccount]:
    """Copy the primary account into `accounts/` so a new sign-in can join it.

    ChatMock's login flow always writes `auth.json`, which means signing in
    again *replaces* the account rather than adding one. Snapshotting the
    current credentials first turns the same flow into "add an account": the
    existing one keeps working from its copy, and the new sign-in becomes the
    primary.

    Returns the preserved account, or None when there is nothing to preserve or
    it is already stored.
    """
    import json
    import os as _os

    auth = _read_auth_path(_primary_path())
    if auth is None:
        return None

    key, email, plan = _identity(auth, _primary_path())
    # Scan the directory rather than list_accounts(): that dedupes by key, so
    # the primary would mask its own copy and every call would write again.
    for path in glob.glob(_os.path.join(accounts_dir(), "*.json")):
        stored = _read_auth_path(path)
        if stored is not None and _identity(stored, path)[0] == key:
            return None  # Already kept; signing in again would duplicate it.

    target = add_account_path(email or key)
    try:
        _os.makedirs(accounts_dir(), exist_ok=True)
        with open(target, "w", encoding="utf-8") as fp:
            if hasattr(_os, "fchmod"):
                _os.fchmod(fp.fileno(), 0o600)
            json.dump(auth, fp, indent=2)
    except OSError:
        return None

    return ChatGptAccount(key=key, path=target, auth=auth, email=email, plan=plan, primary=False)


def forget_account(key: str) -> bool:
    """Remove one additional account. The primary is left to the sign-out flow."""
    import os as _os

    for account in list_accounts():
        if account.key != key or account.primary:
            continue
        try:
            _os.remove(account.path)
        except OSError:
            return False
        failover.clear(account.cooldown_key)
        return True
    return False
