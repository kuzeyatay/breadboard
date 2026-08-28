---
title: "Gauss's Law in Integral Form"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "gauss-law-in-integral-form"
locations: ["Page 65", "Page 66", "Page 67", "Page 83", "Page 84"]
related: ["electric-flux-through-an-oriented-surface", "choosing-gaussian-surfaces-by-symmetry", "maxwells-first-equation", "divergence-theorem"]
---

## ConceptNode: Gauss's Law in Integral Form

Planning node for [[gauss-law-in-integral-form|1.55 Gauss's Law in Integral Form]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 65, Page 66, Page 67, Page 83, Page 84

Gauss's law states that the total outward electric flux through any closed surface equals the total charge enclosed by that surface. In electric-flux-density notation, the law is $\oint_S\mathbf{D}\cdot d\mathbf{S}=Q_{\mathrm{enc}}$. The enclosed charge can arise from point charges, line charge, surface charge, volume charge, or a combination of these. The corresponding calculations are $Q=\sum_n Q_n$, $Q=\int\rho_L\,dL$, $Q=\int_S\rho_S\,dS$, and $Q=\int_V\rho_v\,dv$. The volume-density representation is commonly used as a general expression, giving $\oint_S\mathbf{D}\cdot d\mathbf{S}=\int_V\rho_v\,dv$. Only charge inside the chosen closed surface enters the right-hand side directly. The law determines total flux without requiring the detailed field distribution, but obtaining the field itself from the law generally requires sufficient symmetry. Practice problems emphasize first identifying the enclosed region and then integrating or summing only the charge lying within it.

### Key planning details

- Gauss's law is $\oint_S\mathbf{D}\cdot d\mathbf{S}=Q_{\mathrm{enc}}$.
- The surface $S$ must be closed.
- Point charges contribute through $Q=\sum_n Q_n$.
- Line charge contributes through $Q=\int\rho_L\,dL$.
- Surface charge contributes through $Q=\int_S\rho_S\,dS$.
- Volume charge contributes through $Q=\int_V\rho_v\,dv$.
- The total outward flux is measured in coulombs when $\mathbf{D}$ is in $\mathrm{C/m^2}$.

### Source coverage

- Page 65 states $\Psi=\oint_S\mathbf{D}_S\cdot d\mathbf{S}=Q$.
- Pages 65 and 66 list enclosed-charge formulas for point, line, surface, and volume distributions.
- Page 66 writes $\oint_S\mathbf{D}_S\cdot d\mathbf{S}=\int_{\mathrm{vol}}\rho_v\,dv$.
- Problem D3.4 on Page 67 asks for flux leaving a cube for point, line, and surface charge distributions.
- Problems 3.2 and 3.4 on Pages 83 and 84 ask for charge enclosed by a cube and sphere from specified electric fields.
