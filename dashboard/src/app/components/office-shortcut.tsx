"use client";

import { FileText } from "lucide-react";
import NavigationLink from "./navigation-link";

export default function OfficeShortcut({ className }: { className?: string }) {
  return <NavigationLink href="/office" label="Office" className={className} prefetch={false} title="Docs, sheets, slides and PDFs">
    <FileText size={15} aria-hidden="true" />
    Office
  </NavigationLink>;
}
