"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type SVGProps,
} from "react";
import NavbarFlowerWind from "./navbar-flower-wind";
import styles from "./navbar.module.css";

interface Props {
  email: string;
  username?: string | null;
  actions?: ReactNode;
}

function Icon({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

function PlusIcon() {
  return (
    <Icon className={styles.buttonIcon}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  );
}

function ChevronIcon() {
  return (
    <Icon className={styles.chevronIcon}>
      <path d="m8.5 10 3.5 3.5 3.5-3.5" />
    </Icon>
  );
}

function SignOutIcon() {
  return (
    <Icon className={styles.menuIcon}>
      <path d="M10 17l5-5-5-5" />
      <path d="M15 12H3" />
      <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
    </Icon>
  );
}

function CloseIcon() {
  return (
    <Icon className={styles.closeIcon}>
      <path d="m6 6 12 12M18 6 6 18" />
    </Icon>
  );
}

function Spinner() {
  return (
    <svg className={styles.spinner} viewBox="0 0 24 24" fill="none">
      <circle
        className={styles.spinnerTrack}
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className={styles.spinnerArc}
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

function accountInitials(value: string): string {
  const parts = value
    .trim()
    .split(/[^a-z0-9]+/i)
    .filter(Boolean);

  if (parts.length > 1) {
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }

  return (parts[0]?.slice(0, 2) || "BB").toUpperCase();
}

export default function NavBar({ email, username, actions }: Props) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  const displayName = username?.trim() || email.split("@")[0] || "Account";
  const initials = accountInitials(displayName);

  useEffect(() => {
    function closeAccountMenu(event: PointerEvent) {
      if (
        accountRef.current &&
        !accountRef.current.contains(event.target as Node)
      ) {
        setAccountOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setAccountOpen(false);
        setInviteOpen(false);
      }
    }

    document.addEventListener("pointerdown", closeAccountMenu);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeAccountMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  function openInviteModal() {
    setAccountOpen(false);
    setInviteOpen(true);
    setInviteCode("");
    setInviteError(null);
    setCopied(false);
  }

  async function createInvite() {
    setInviteLoading(true);
    setInviteError(null);
    setInviteCode("");
    setCopied(false);

    try {
      const response = await fetch("/api/invites", { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || typeof data.code !== "string") {
        throw new Error(
          typeof data.error === "string"
            ? data.error
            : "Could not create invite",
        );
      }
      setInviteCode(data.code);
    } catch (error) {
      setInviteError(
        error instanceof Error ? error.message : "Could not create invite",
      );
    } finally {
      setInviteLoading(false);
    }
  }

  async function copyInvite() {
    if (!inviteCode) return;
    try {
      await navigator.clipboard.writeText(inviteCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setInviteError("Could not copy invite");
    }
  }

  return (
    <>
      <nav className={styles.navbar} aria-label="Primary navigation">
        <NavbarFlowerWind />

        <Link className={styles.brand} href="/dashboard" aria-label="Breadboard dashboard">
          <span className={styles.brandMark}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="" className={styles.logo} />
          </span>
          <span className={styles.brandCopy}>
            <span className={styles.brandName}>breadboard</span>
            <span className={styles.brandTagline}>knowledge garden</span>
          </span>
        </Link>

        <div className={styles.workspaceRail}>
          <span className={styles.workspaceLabel}>
            <span className={styles.statusDot} />
            Workspace
          </span>
          <span className={styles.railDivider} />
          <div className={styles.actionSlot}>{actions}</div>
        </div>

        <div className={styles.accountRail}>
          <button
            type="button"
            onClick={openInviteModal}
            className={styles.inviteButton}
          >
            <PlusIcon />
            <span>Invite</span>
          </button>

          <div className={styles.account} ref={accountRef}>
            <button
              type="button"
              className={styles.accountTrigger}
              aria-expanded={accountOpen}
              aria-controls="account-menu"
              onClick={() => setAccountOpen((open) => !open)}
            >
              <span className={styles.avatar}>{initials}</span>
              <span className={styles.accountCopy}>
                <span className={styles.accountName}>{displayName}</span>
                <span className={styles.accountState}>Local workspace</span>
              </span>
              <ChevronIcon />
            </button>

            {accountOpen && (
              <div className={styles.accountMenu} id="account-menu">
                <div className={styles.menuHeader}>
                  <span className={styles.menuAvatar}>{initials}</span>
                  <span className={styles.menuIdentity}>
                    <strong>{displayName}</strong>
                    <span title={email}>{email}</span>
                  </span>
                </div>
                <div className={styles.menuStatus}>
                  <span className={styles.statusDot} />
                  Connected to Breadboard
                </div>
                <button
                  type="button"
                  className={styles.signOutButton}
                  onClick={() => signOut({ callbackUrl: "/auth/login" })}
                >
                  <SignOutIcon />
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      {inviteOpen && (
        <div
          className={styles.modalBackdrop}
          onClick={(event) => {
            if (event.target === event.currentTarget) setInviteOpen(false);
          }}
        >
          <section
            className={styles.inviteDialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="invite-title"
          >
            <div className={styles.dialogAccent} />
            <button
              type="button"
              className={styles.closeButton}
              onClick={() => setInviteOpen(false)}
              aria-label="Close invite dialog"
            >
              <CloseIcon />
            </button>

            <div className={styles.dialogHeader}>
              <span className={styles.dialogIcon}>
                <PlusIcon />
              </span>
              <div>
                <h2 id="invite-title">Invite someone</h2>
                <p>Create a one-time code for a new account.</p>
              </div>
            </div>

            {inviteCode ? (
              <div className={styles.dialogContent}>
                <label className={styles.fieldLabel} htmlFor="invite-code">
                  Invite code
                </label>
                <div className={styles.codeRow}>
                  <input
                    id="invite-code"
                    value={inviteCode}
                    readOnly
                    className={styles.codeInput}
                  />
                  <button
                    type="button"
                    onClick={copyInvite}
                    className={styles.copyButton}
                  >
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
                {inviteError && (
                  <p className={styles.errorMessage}>{inviteError}</p>
                )}
                <div className={styles.dialogActions}>
                  <button
                    type="button"
                    onClick={() => setInviteOpen(false)}
                    className={styles.secondaryButton}
                  >
                    Done
                  </button>
                  <button
                    type="button"
                    onClick={createInvite}
                    disabled={inviteLoading}
                    className={styles.primaryButton}
                  >
                    {inviteLoading && <Spinner />}
                    {inviteLoading ? "Creating..." : "Create another"}
                  </button>
                </div>
              </div>
            ) : (
              <div className={styles.dialogContent}>
                <div className={styles.inviteNote}>
                  Invite codes can be used once and keep your workspace private.
                </div>
                {inviteError && (
                  <p className={styles.errorMessage}>{inviteError}</p>
                )}
                <div className={styles.dialogActions}>
                  <button
                    type="button"
                    onClick={() => setInviteOpen(false)}
                    className={styles.secondaryButton}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={createInvite}
                    disabled={inviteLoading}
                    className={styles.primaryButton}
                  >
                    {inviteLoading && <Spinner />}
                    {inviteLoading ? "Creating..." : "Create invite"}
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}
