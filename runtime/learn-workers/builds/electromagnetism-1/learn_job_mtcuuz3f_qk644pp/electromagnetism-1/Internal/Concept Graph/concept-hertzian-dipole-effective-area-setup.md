---
title: "Hertzian Dipole Effective Area Setup"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "hertzian-dipole-effective-area-setup"
locations: ["Page 560", "Page 562", "Section 14.7.2", "Example 14.6", "Figure 14.18"]
related: ["effective-area-and-the-transmit-receive-power-ratio", "antenna-reciprocity-and-identical-transmit-receive-patterns", "receiving-antenna-equivalent-circuit-and-matched-load"]
---

## ConceptNode: Hertzian Dipole Effective Area Setup

Planning node for [[hertzian-dipole-effective-area-setup|1.333 Hertzian Dipole Effective Area Setup]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 560, Page 562, Section 14.7.2, Example 14.6, Figure 14.18

The Hertzian dipole provides a reference antenna for evaluating the universal directivity-to-effective-area ratio. An incident electric field $E_i$ drives the receiving dipole only through its component parallel to the wire. In the coplanar geometry of the source, the projection angle satisfies $\alpha=90^\circ-\theta_2$, so the induced input voltage is $V_{\mathrm{in}}=E_id\cos\alpha=E_id\sin\theta_2$, where $d$ is the dipole length. With a conjugate-matched load, the load current is $I_L=E_id\sin\theta_2/(2R_{22})$. The resulting load power is $P_{L2}=(E_id)^2\sin^2\theta_2/(8R_{22})$. Substituting the Hertzian-dipole radiation resistance $R_{22}=80\pi^2(d/\lambda)^2$ eliminates the physical dipole length and gives $P_{L2}=(1/640)(E_i\lambda\sin\theta_2/\pi)^2$. The incident free-space power density is $S_{r1}=E_i^2/(2\eta_0)=E_i^2/(240\pi)$. These expressions provide the quantities needed to calculate the Hertzian dipole's directional effective area, but the source chunk ends before that final division is shown.

### Key planning details

- Only the incident electric-field component parallel to the receiving dipole induces voltage.
- The induced voltage is $V_{\mathrm{in}}=E_id\sin\theta_2$.
- With conjugate matching, $I_L=E_id\sin\theta_2/(2R_{22})$.
- Matched-load power is $(E_id)^2\sin^2\theta_2/(8R_{22})$.
- The Hertzian-dipole resistance is $80\pi^2(d/\lambda)^2$.
- Substitution gives $P_{L2}=(1/640)(E_i\lambda\sin\theta_2/\pi)^2$.
- Incident free-space power density is $E_i^2/(240\pi)$.
- The chunk stops before explicitly stating the resulting effective-area formula.

### Source coverage

- Figure S26.P560.F14.18 shows incident field $E_i$ at angle $\alpha$ to antenna 2 and states $\alpha=90^\circ-\theta_2$.
- Example 14.6, Page 562 gives $V_{\mathrm{in}}=E_id\sin\theta_2$.
- The matched-load current is $I_L=E_id\sin\theta_2/(2R_{22})$.
- Equation (99), Page 562 gives $P_{L2}=(E_id)^2\sin^2\theta_2/(8R_{22})$.
- The Hertzian-dipole radiation resistance is $R_{22}=80\pi^2(d/\lambda)^2$.
- Equation (100), Page 562 gives the simplified received power.
- Equation (101), Page 562 gives $S_{r1}=E_i^2/(240\pi)$ in free space.
