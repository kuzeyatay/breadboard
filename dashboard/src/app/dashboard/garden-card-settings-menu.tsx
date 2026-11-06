"use client";

import { useRef, useState, type CSSProperties } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronRight, Download, GitBranch, Globe, LoaderCircle, Pencil, Settings, Trash2 } from "lucide-react";
import type { Cluster, ClusterVisibility } from "@/app/actions/clusters";
import styles from "./garden-card-settings-menu.module.css";

interface Props {
  cluster: Cluster;
  organizations: { id: number; name: string }[];
  repositoryBusy: boolean;
  connecting: boolean;
  exportBusy: boolean;
  exporting: boolean;
  deleting: boolean;
  onOpen: () => void;
  onConnectRepository: () => void;
  onEdit: () => void;
  onExport: () => void;
  onVisibilityChange: (visibility: ClusterVisibility, organizationId: number | null) => void;
  onDelete: () => void;
}

export default function GardenCardSettingsMenu({
  cluster, organizations, repositoryBusy, connecting, exportBusy, exporting,
  deleting, onOpen, onConnectRepository, onEdit, onExport, onVisibilityChange, onDelete,
}: Props) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const openingDialogRef = useRef(false);
  const [palette, setPalette] = useState<CSSProperties>();
  const visibilityOptions = [
    { value: "private", label: "Keep private", visibility: "private" as const, organizationId: null },
    ...organizations.map((organization) => ({
      value: `organization-${organization.id}`,
      label: `Share with ${organization.name}`,
      visibility: "organization" as const,
      organizationId: organization.id,
    })),
    { value: "public", label: "Share publicly", visibility: "public" as const, organizationId: null },
  ];
  const visibilityValue = cluster.visibility === "organization"
    ? `organization-${cluster.organization_id}`
    : cluster.visibility;

  return (
    <Menu.Root modal={false} onOpenChange={(open) => {
      if (!open) return;
      openingDialogRef.current = false;
      // Portals escape the resizable card's clipping. Carry its wallpaper
      // palette with them so the menu matches the garden on every background.
      if (triggerRef.current) {
        const computed = getComputedStyle(triggerRef.current);
        setPalette({
          "--garden-menu-surface": computed.getPropertyValue("--home-widget-tint").trim() || computed.getPropertyValue("--paper-surface").trim(),
          "--garden-menu-ink": computed.color,
        } as CSSProperties);
      }
      onOpen();
    }}>
      <Menu.Trigger asChild>
        <button
          ref={triggerRef}
          type="button"
          data-card-action="true"
          className={`neu-button ${styles.trigger}`}
          aria-label={`Settings for ${cluster.name}`}
          title="Garden settings"
          disabled={deleting}
        >
          <Settings aria-hidden="true" />
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          className={styles.menu}
          style={palette}
          data-card-action="true"
          aria-label={`Settings for ${cluster.name}`}
          side="bottom"
          align="end"
          sideOffset={8}
          collisionPadding={16}
          onCloseAutoFocus={(event) => {
            if (openingDialogRef.current) event.preventDefault();
          }}
        >
          <Menu.Item className={styles.item} disabled={repositoryBusy} onSelect={onConnectRepository}>
            {connecting ? <LoaderCircle className={styles.spinner} /> : <GitBranch />}
            <span>
              {connecting ? "Connecting repository…" : cluster.repo_connected ? "Change repository" : "Connect repository"}
              {cluster.repo_connected && cluster.repo_name && <small>{cluster.repo_name}</small>}
            </span>
          </Menu.Item>
          <Menu.Item className={styles.item} onSelect={() => {
            openingDialogRef.current = true;
            onEdit();
          }}>
            <Pencil /> Edit garden
          </Menu.Item>
          <Menu.Item className={styles.item} disabled={exportBusy} onSelect={onExport}>
            {exporting ? <LoaderCircle className={styles.spinner} /> : <Download />}
            {exporting ? "Exporting garden…" : "Export garden"}
          </Menu.Item>
          <Menu.Sub>
            <Menu.SubTrigger className={styles.item}>
              <Globe />
              <span>Visibility<small>{cluster.visibility === "organization" ? cluster.organizationName ?? "Organization" : cluster.visibility}</small></span>
              <ChevronRight className={styles.chevron} />
            </Menu.SubTrigger>
            <Menu.Portal>
              <Menu.SubContent className={styles.menu} style={palette} data-card-action="true" sideOffset={6} collisionPadding={16}>
                <Menu.RadioGroup value={visibilityValue} onValueChange={(value) => {
                  const option = visibilityOptions.find((item) => item.value === value);
                  if (option) onVisibilityChange(option.visibility, option.organizationId);
                }}>
                  {visibilityOptions.map((option) => (
                    <Menu.RadioItem className={styles.item} value={option.value} key={option.value}>
                      <span className={styles.indicator}><Menu.ItemIndicator><Check /></Menu.ItemIndicator></span>
                      {option.label}
                    </Menu.RadioItem>
                  ))}
                </Menu.RadioGroup>
              </Menu.SubContent>
            </Menu.Portal>
          </Menu.Sub>
          <Menu.Separator className={styles.separator} />
          <Menu.Item className={`${styles.item} ${styles.danger}`} disabled={deleting} onSelect={() => {
            openingDialogRef.current = true;
            onDelete();
          }}>
            <Trash2 /> Delete garden
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
