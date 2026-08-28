---
title: "Magnetization and Bound Currents"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "magnetization-and-bound-currents"
locations: ["Page 262", "Page 263", "Page 264", "Section 8.6", "Figure 8.9"]
related: ["classification-of-magnetic-materials", "free-bound-and-total-magnetic-currents", "linear-magnetic-constitutive-relations"]
---

## ConceptNode: Magnetization and Bound Currents

Planning node for [[magnetization-and-bound-currents|1.119 Magnetization and Bound Currents]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 262, Page 263, Page 264, Section 8.6, Figure 8.9

Magnetization $\mathbf{M}$ gives a macroscopic description of microscopic magnetic dipoles. A bound current $I_b$ circulating around a differential vector area $d\mathbf{S}$ produces the dipole moment $\mathbf{m}=I_b d\mathbf{S}$. For $n$ dipoles per unit volume, the total moment in a small volume is the vector sum of the individual moments. Magnetization is defined as the limiting dipole moment per unit volume, so $\mathbf{M}=\lim_{\Delta v\to0}(1/\Delta v)\sum_i\mathbf{m}_i$. Only when all dipoles are identical and identically oriented does this reduce to $\mathbf{M}=n\mathbf{m}$. Its units are amperes per meter, the same as those of $\mathbf{H}$. Partial alignment of the dipoles causes microscopic bound-current loops to reinforce one another along a chosen contour. For a differential path segment, the resulting bound-current increment is $dI_B=\mathbf{M}\cdot d\mathbf{L}$. Integration around a closed contour gives $I_B=\oint\mathbf{M}\cdot d\mathbf{L}$. Stokes' theorem then converts this integral relationship to the local current-density equation $\nabla\times\mathbf{M}=\mathbf{J}_B$.

### Key planning details

- A microscopic current loop has dipole moment $\mathbf{m}=I_b d\mathbf{S}$.
- The total dipole moment is the vector sum $\mathbf{m}_{total}=\sum_i\mathbf{m}_i$.
- Magnetization is magnetic dipole moment per unit volume.
- The simplification $\mathbf{M}=n\mathbf{m}$ applies only to identical dipoles.
- Magnetization has units of A/m.
- Dipole alignment produces a net bound current through the surface enclosed by a contour.
- The contour relation is $I_B=\oint\mathbf{M}\cdot d\mathbf{L}$.
- The corresponding local relation is $\mathbf{J}_B=\nabla\times\mathbf{M}$.

### Source coverage

- Equation (19) defines $\mathbf{M}=\lim_{\Delta v\to0}(1/\Delta v)\sum_i\mathbf{m}_i$ and gives $\mathbf{M}=n\mathbf{m}$ for identical dipoles.
- Equation (20) derives $dI_B=nI_b d\mathbf{S}\cdot d\mathbf{L}=\mathbf{M}\cdot d\mathbf{L}$.
- Equation (21) states $I_B=\oint\mathbf{M}\cdot d\mathbf{L}$.
- Figure S13.P262.F8.9 shows partially aligned dipoles along a closed-path segment and interprets the increase $nI_b d\mathbf{S}\cdot d\mathbf{L}$ in bound current.
- Page 264 gives the differential relationship $\nabla\times\mathbf{M}=\mathbf{J}_B$.
