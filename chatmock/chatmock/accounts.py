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
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from . import failover
from .utils import _read_auth_path, get_auth_file_override, get_home_dir, parse_jwt_claims

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
    return get_auth_file_override() or os.path.join(get_home_dir(), "auth.json")


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


#: Plans the Codex backend refuses outright — every request answers "The
#: '<model>' model is not supported when using Codex with a ChatGPT account".
#: Such an account is not a stand-in: handing it a request after a paid
#: sibling's 429 replaces "your weekly limit is spent" with a model-support
#: error that names the wrong problem entirely.
_PLANS_WITHOUT_CODEX = frozenset({"free"})


def can_serve_codex(account: ChatGptAccount) -> bool:
    """Whether this account's plan can use Codex at all. Unknown plans are assumed able."""
    return (account.plan or "").strip().lower() not in _PLANS_WITHOUT_CODEX


def _candidate_accounts() -> List[ChatGptAccount]:
    """Accounts worth sending a Codex request to, in routing order.

    A plan that cannot serve Codex is only considered when no other account
    exists at all: then it is still the right credential to produce the
    refusal that tells the user why nothing works.
    """
    accounts = list_accounts()
    capable = [account for account in accounts if can_serve_codex(account)]
    return capable or accounts


def healthy_accounts() -> List[ChatGptAccount]:
    return [account for account in _candidate_accounts() if not failover.is_cooling(account.cooldown_key)]


def select_account() -> Optional[ChatGptAccount]:
    """The account requests should use: the first that is not exhausted.

    When every account is cooling, the first is returned anyway — the caller
    still needs credentials to produce a meaningful upstream error, and the
    model-level failover above it is what moves traffic to another provider.
    A spent paid account is preferred over a free one for that error too: its
    429 says "the weekly limit is spent, back on Monday", which the reader can
    act on, where the free account's refusal cannot be.
    """
    accounts = _candidate_accounts()
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


def _connected_at(account: ChatGptAccount) -> Optional[str]:
    """Original sign-in time when known, with file creation as a legacy fallback."""
    stored = account.auth.get("connected_at")
    if isinstance(stored, str):
        try:
            parsed = datetime.fromisoformat(stored.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
        except ValueError:
            pass

    try:
        stat = os.stat(account.path)
        # st_birthtime is stable on platforms that expose it; Windows' ctime
        # is creation time. Other platforms fall back to mtime for old auth
        # files written before connected_at was stored in the JSON.
        timestamp = getattr(stat, "st_birthtime", None)
        if timestamp is None:
            timestamp = stat.st_ctime if os.name == "nt" else stat.st_mtime
        return datetime.fromtimestamp(timestamp, timezone.utc).isoformat().replace("+00:00", "Z")
    except (OSError, OverflowError, ValueError):
        return None


def account_state() -> List[Dict[str, Any]]:
    """Redacted account list for the management API. Never includes a token."""
    state: List[Dict[str, Any]] = []
    serving = select_account()
    for account in list_accounts():
        cooldown = failover.cooldown_for(account.cooldown_key)
        connected_at = _connected_at(account)
        stand_in = (
            serving
            if account.primary and serving is not None and serving.key != account.key
            else None
        )
        state.append(
            {
                "key": account.key,
                "email": account.email,
                "plan": account.plan,
                "primary": account.primary,
                # The account the user chose: the primary, which Switch and
                # sign-in both write. It stays chosen while it rests — the
                # choice is not undone by a spent plan window — and `standIn`
                # names the sibling taking its requests meanwhile, so the
                # client can say both things instead of flipping the choice.
                "active": account.primary,
                "standIn": stand_in.label if stand_in is not None else None,
                "serving": serving is not None and serving.key == account.key,
                # File time is the only chronology shared by the primary
                # credential and preserved siblings. Keep routing order in
                # list_accounts(); only the management view is chronological.
                "connectedAt": connected_at,
                "path": account.path,
                "available": cooldown is None,
                "cooldownSeconds": cooldown.remaining_seconds if cooldown else 0,
                "cooldownReason": cooldown.reason if cooldown else None,
            }
        )
    return sorted(
        state,
        key=lambda row: (
            row["connectedAt"] is None,
            row["connectedAt"] or "",
        ),
    )


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


def activate_account(key: str) -> bool:
    """Make one account the primary, so requests go to it first.

    Selection is sticky on the first healthy account and the primary leads the
    order, so swapping which credential `auth.json` holds is the whole of
    "switch": nothing running has to be told. The outgoing primary is kept in
    `accounts/` exactly as preserve_current_account() would keep it, and the
    incoming one's copy is removed once it is safely the primary — the same
    account never lives in two files.

    The chosen account also comes off any quota cooldown. Choosing it is an
    instruction, not a guess: if its window really is still spent the next
    request re-benches it and selection steps to a sibling as before. This is
    what lets a resting primary be picked back deliberately.

    False when the key names no signed-in account or a file could not be
    written.
    """
    import os as _os

    from .utils import write_auth_file

    target = next((account for account in list_accounts() if account.key == key), None)
    if target is None:
        return False
    failover.clear(target.cooldown_key)
    if target.primary:
        return True

    current = _read_auth_path(_primary_path())
    if current is not None:
        current_key, current_email, _plan = _identity(current, _primary_path())
        kept = any(
            (stored := _read_auth_path(path)) is not None
            and _identity(stored, path)[0] == current_key
            for path in glob.glob(_os.path.join(accounts_dir(), "*.json"))
        )
        if not kept and not write_auth_file(
            current, add_account_path(current_email or current_key)
        ):
            return False

    if not write_auth_file(target.auth, _primary_path()):
        return False
    try:
        _os.remove(target.path)
    except OSError:
        # list_accounts() dedupes by identity, so a leftover copy is masked by
        # the primary rather than counted twice.
        pass
    return True
