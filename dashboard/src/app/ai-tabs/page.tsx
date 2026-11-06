import type { Metadata } from "next";
import styles from "./page.module.css";

export const metadata: Metadata = { title: "AI tabs — breadboard" };

export default function AiTabsPage() {
  return (
    <main className={styles.page}>
      <p>Bread can open tabs on your behalf, they appear here.</p>
    </main>
  );
}
