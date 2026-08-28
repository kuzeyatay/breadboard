---
title: "Fields and Polarization Inside a Teflon Slab"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "fields-and-polarization-inside-a-teflon-slab"
locations: ["Page 150", "Page 151", "Example 5.5", "Figure 5.12"]
related: ["refraction-of-fields-at-a-dielectric-boundary", "normal-and-tangential-field-decomposition", "dielectric-polarization-and-effective-permittivity-tasks"]
---

## ConceptNode: Fields and Polarization Inside a Teflon Slab

Planning node for [[fields-and-polarization-inside-a-teflon-slab|1.71 Fields and Polarization Inside a Teflon Slab]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 150, Page 151, Example 5.5, Figure 5.12

Example 5.5 applies dielectric boundary conditions to a Teflon slab occupying $0\leq x\leq a$, with free space on both sides and a uniform external field $\mathbf E_{\text{out}}=E_0\mathbf a_x$. Because the field is normal to the slab interfaces and no free surface charge is specified, the normal component of $\mathbf D$ is continuous. Therefore, $\mathbf D_{\text{in}}=\mathbf D_{\text{out}}=\epsilon_0E_0\mathbf a_x$. Inside Teflon, whose relative permittivity is $\epsilon_r=2.1$, the electric field is reduced by the factor $1/\epsilon_r$, giving $\mathbf E_{\text{in}}=0.476E_0\mathbf a_x$. Polarization accounts for the difference between total flux density and the vacuum contribution $\epsilon_0\mathbf E$. Using $\mathbf D=\epsilon_0\mathbf E+\mathbf P$ gives $\mathbf P_{\text{in}}=0.524\epsilon_0E_0\mathbf a_x$. The example illustrates a general solution order: infer the known field quantities in one region, apply the relevant component boundary condition, use the constitutive relation in the second material, and then calculate polarization. Figure 5.12 depicts this external-to-internal field workflow.

### Key planning details

- The Teflon slab occupies $0\leq x\leq a$ and has $\epsilon_r=2.1$.
- The applied field is normal to the slab: $\mathbf E_{\text{out}}=E_0\mathbf a_x$.
- Normal $\mathbf D$ continuity gives $\mathbf D_{\text{in}}=\epsilon_0E_0\mathbf a_x$.
- The internal electric field is reduced to $0.476E_0\mathbf a_x$.
- The internal polarization is $0.524\epsilon_0E_0\mathbf a_x$.
- Boundary conditions connect partial field information on both sides of an interface.

### Source coverage

- Outside the slab, $\mathbf D_{\text{out}}=\epsilon_0E_0\mathbf a_x$ and $\mathbf P_{\text{out}}=0$.
- $\mathbf E_{\text{in}}=\mathbf D_{\text{in}}/(\epsilon_r\epsilon_0)=0.476E_0\mathbf a_x$.
- $$\mathbf P_{\text{in}}=\mathbf D_{\text{in}}-\epsilon_0\mathbf E_{\text{in}}=0.524\epsilon_0E_0\mathbf a_x.$$
- All three internal fields are specified for $0\leq x\leq a$.
- Figure 5.12 explains that known external $\mathbf E$ determines the other external fields before normal $\mathbf D$ continuity is used.
- Visual opportunity S1.P151.F1: recreate Figure 5.12 as a slab diagram showing $\mathbf E$, $\mathbf D$, and $\mathbf P$ inside and outside.
