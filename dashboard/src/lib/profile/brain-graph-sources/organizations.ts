import {
  brainEdgeId,
  memberNodeId,
} from "../brain-graph-ids.ts";
import {
  organizationForScope,
  type BrainGraphAccessContext,
} from "../brain-graph-auth.ts";
import type {
  BrainEdge,
  BrainGraphFragment,
  BrainGraphLimits,
  BrainNode,
  BrainScope,
} from "../brain-graph-types.ts";

const SELF_ID = "user:self";

function organizationNodeId(publicId: string): string {
  return `organization:${publicId}`;
}

export const organizationsBrainSource = {
  name: "organizations",
  buildOverview(
    context: BrainGraphAccessContext,
    scope: BrainScope,
    _limits: BrainGraphLimits,
  ): BrainGraphFragment {
    const nodes: BrainNode[] = [];
    const edges: BrainEdge[] = [];
    const organizations =
      scope.kind === "personal"
        ? []
        : scope.kind === "organization"
          ? [organizationForScope(context, scope)].filter(Boolean)
          : context.organizations;

    nodes.push({
      id: SELF_ID,
      kind: "user",
      label: context.username,
      subtitle: "You",
      href: "/profile?tab=knowledge&scope=personal",
      origins: ["organization"],
      expandable: true,
      metadata: { currentUser: true },
    });

    for (const organization of organizations) {
      if (!organization) continue;
      const orgId = organizationNodeId(organization.publicId);
      nodes.push({
        id: orgId,
        kind: "organization",
        label: organization.name,
        subtitle: `${organization.members.length} ${organization.members.length === 1 ? "member" : "members"}`,
        href: `/profile?tab=knowledge&scope=organization&organization=${encodeURIComponent(organization.publicId)}`,
        origins: ["organization"],
        organizationId: organization.publicId,
        createdAt: organization.createdAt,
        expandable: true,
        metrics: { activity: organization.members.length },
        metadata: { role: organization.role, memberCount: organization.members.length },
      });

      for (const member of organization.members) {
        const nodeId =
          member.userId === context.userId ? SELF_ID : memberNodeId(member.username);
        if (nodeId !== SELF_ID) {
          nodes.push({
            id: nodeId,
            kind: "member",
            label: member.username,
            subtitle: member.role,
            href: `/dashboard?person=${encodeURIComponent(member.username)}`,
            origins: ["organization"],
            organizationId: organization.publicId,
            createdAt: member.joinedAt,
            expandable: true,
            metadata: { role: member.role },
          });
        }
        edges.push({
          id: brainEdgeId(nodeId, orgId, "member_of", "organization"),
          source: nodeId,
          target: orgId,
          relation: "member_of",
          origin: "organization",
          explicit: true,
          organizationId: organization.publicId,
          weight: member.role === "owner" ? 1.4 : member.role === "admin" ? 1.2 : 1,
        });
      }
    }

    return { nodes, edges };
  },
};
