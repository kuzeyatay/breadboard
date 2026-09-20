# Keeping runtime data and credentials private

Run `node scripts/check-repository-security.mjs --paths-only` to inspect tracked
paths. Install Gitleaks and enable the local hook with
`git config core.hooksPath .githooks`; each commit then scans its staged changes,
and each push checks outgoing history as well as the destination tree.
`GITLEAKS_BIN` can point to a verified Gitleaks executable outside PATH.

The repository's security workflow checks every new commit and rejects tracked
runtime databases, per-install key files, local environment settings, and Next.js
build output. Reviewed upstream environment files containing build flags or
publishable client keys are individually listed in the path checker. Changes to
those files still pass through the credential scanner.

Store runtime credentials and databases outside tracked source directories.
`.gitignore` does not remove an already tracked file or an earlier Git blob.
Do not commit generated builds: Next.js output can contain generated signing and
encryption keys even when source environment files are ignored.

Both the Hermes dashboard and tool clients must receive
`BREADBOARD_HERMES_TOOL_SECRET` (or the compatibility name `HERMES_TOOL_SECRET`).
The standard launchers generate and pass the shared secret. A missing or blank
value fails closed; account passwords are not accepted as tool service secrets.

Account sessions are bound to the password version verified during sign-in.
Changing a stored password invalidates earlier sessions on their next server
validation. Sessions issued before this binding was added require a fresh
sign-in. This does not rotate `NEXTAUTH_SECRET`, which may also protect stored
integration credentials.

If a credential is published, revoke or rotate it before cleaning Git history.
Reset exposed account passwords and invalidate exposed invitation codes. Perform
any history rewrite in an isolated clone, preserve active work, update every
affected public branch, and coordinate cleanup of other clones and GitHub's
cached sensitive objects. See
[GitHub's removal guide](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository).

After a coordinated history rewrite, do not merge or push an old local branch
back into the repository: that can republish the removed data. Rebase clean
changes onto the new history or use a fresh clone.
