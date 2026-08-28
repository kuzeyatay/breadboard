---
title: "Flux Linkage and Self-Inductance"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "flux-linkage-and-self-inductance"
locations: ["Page 277", "Page 278", "Page 279", "Page 283", "Section 8.10.1", "Figure 8.14", "Problem D8.12"]
related: ["air-core-toroid-circuit-calculation", "energy-and-vector-potential-definitions-of-inductance", "internal-and-external-inductance", "mutual-inductance-and-reciprocity"]
---

## ConceptNode: Flux Linkage and Self-Inductance

Planning node for [[flux-linkage-and-self-inductance|1.129 Flux Linkage and Self-Inductance]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 277, Page 278, Page 279, Page 283, Section 8.10.1, Figure 8.14, Problem D8.12

Flux linkage accounts for both the magnetic flux through a coil and the number of turns linked by that flux. If the same total flux $\Phi$ links each of $N$ turns, the total linkage is $N\Phi$. Self-inductance is defined for a linear magnetic system by $L=N\Phi/I$, where current $I$ produces the flux. Its unit is the henry, equivalent to a weber-turn per ampere. For a single-turn coaxial path of length $d$, inner radius $a$, and outer radius $b$, the source uses the known flux to obtain $L=(\mu_0d/2\pi)\ln(b/a)$ and $L'=(\mu_0/2\pi)\ln(b/a)$ H/m. For a closely wound toroid with mean radius $\rho_0$, area $S$, and $N$ turns, $L=\mu_0N^2S/(2\pi\rho_0)$. The $N^2$ dependence arises because one factor of $N$ increases the field-producing ampere-turns and the second counts the turns linked by the resulting flux. If different turns link different amounts of flux, the exact total is $\sum_{i=1}^N\Phi_i$, and winding or pitch factors are used to correct ideal formulas.

### Key planning details

- Flux linkage is the sum of the flux linking each turn.
- If every turn links the same flux, total linkage is $N\Phi$.
- Self-inductance is $L=N\Phi/I$ for linear media.
- One henry equals one weber-turn per ampere.
- Coaxial-cable inductance depends logarithmically on $b/a$.
- Ideal toroidal-coil inductance is proportional to $N^2S/\rho_0$.
- Partial linkage requires the sum $\sum_i\Phi_i$ rather than a simple product.
- Winding and pitch factors provide empirical corrections for real coils.

### Source coverage

- Equation (49) defines $L=N\Phi/I$.
- Equation (50) gives coaxial inductance per length as $L'=(\mu_0/2\pi)\ln(b/a)$ H/m for the stated free-space case.
- Equation (51) gives toroidal inductance $L=\mu_0N^2S/(2\pi\rho_0)$.
- Figure S13.P279.F8.14 depicts partial flux linkages in a coil with appreciable turn spacing.
- Page 279 gives $(N\Phi)_{total}=\sum_{i=1}^N\Phi_i$.
- Problem D8.12 applies self-inductance methods to a coaxial cable, toroidal coil, and nonuniform-core solenoid.
