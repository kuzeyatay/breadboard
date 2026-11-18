"use client";

import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import styles from "./post-card.module.css";

/**
 * A crumb drawn as a post, laid out like a timeline post: an optional context
 * line ("in Research lab"), the photo in its own column, the name line, the
 * text, then one row of actions with the menu at its far end. The feed and the
 * browser panel both draw their crumbs with it, so a crumb looks the same
 * wherever it is read.
 */
export function PostCard({ context, avatar, name, handle, time, menu, children, actions, endActions, after, className, ...article }: {
  context?: ReactNode; avatar?: ReactNode; name: string; handle?: string | null; time?: ReactNode; menu?: ReactNode;
  children: ReactNode; actions?: ReactNode; endActions?: ReactNode; after?: ReactNode;
} & HTMLAttributes<HTMLElement>) {
  return <article className={`${styles.card}${className ? ` ${className}` : ""}`} {...article}>
    {context && <p className={styles.context} data-has-photo={avatar ? true : undefined}>{context}</p>}
    <div className={styles.row}>
      {avatar && <div className={styles.photo}>{avatar}</div>}
      <div className={styles.main}>
        <header className={styles.head}>
          <span className={styles.who}><strong>{name}</strong>{handle && <span>@{handle}</span>}{time}</span>
        </header>
        <div className={styles.body}>{children}</div>
        {(actions || endActions || menu) && <div className={styles.actions} role="group" aria-label="Actions">
          <div className={styles.lead}>{actions}</div>
          {(endActions || menu) && <div className={styles.tail}>{endActions}{menu}</div>}
        </div>}
        {after}
      </div>
    </div>
  </article>;
}

/** One action in the bottom row: an icon in a round hit area, with its count beside it. */
export function PostAction({ icon, count, label, ...button }: { icon: ReactNode; count?: number | string; label: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <span><button type="button" className={styles.action} aria-label={label} title={label} {...button}>
    <span className={styles.glyph}>{icon}</span>{count ? <span>{count}</span> : null}
  </button></span>;
}

/** The menu at the end of the name line. */
export function PostMenu({ label, children }: { label: string; children: ReactNode }) {
  return <details className={styles.menu}>
    <summary aria-label={label} title="More"><MoreHorizontal size={18} /></summary>
    <div>{children}</div>
  </details>;
}

export function PostMenuItem({ icon, danger, children, onClick, ...button }: { icon: ReactNode; danger?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={styles.item} data-danger={danger || undefined} {...button}
    onClick={event => { const menu = event.currentTarget.closest("details"); if (menu) menu.open = false; onClick?.(event); }}>
    {icon}<span>{children}</span>
  </button>;
}

/** A piece of the action row that is information, not a control. */
export function PostLabel({ children }: { children: ReactNode }) {
  return <span className={styles.label}>{children}</span>;
}
