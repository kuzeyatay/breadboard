---
title: "Derivation and Distance Scaling of the Infinite-Line Field"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "derivation-and-distance-scaling-of-the-infinite-line-field"
locations: ["Page 49", "Page 50", "Section: 2.4.1 Setting Up the Problem: The Importance of Symmetry"]
related: ["symmetry-of-an-infinite-uniform-line-charge", "off-axis-infinite-line-charge", "multipoles-finite-charge-distributions-and-far-field-limits", "streamline-representation-of-electric-fields", "field-of-an-infinite-uniform-sheet"]
---

## ConceptNode: Derivation and Distance Scaling of the Infinite-Line Field

Planning node for [[derivation-and-distance-scaling-of-the-infinite-line-field|1.43 Derivation and Distance Scaling of the Infinite-Line Field]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 49, Page 50, Section: 2.4.1 Setting Up the Problem: The Importance of Symmetry

For an infinite line charge on the $z$ axis, an element $dQ=\rho_Ldz'$ at source coordinate $z'$ contributes a Coulomb field at a point a radial distance $\rho$ away. The source-to-field displacement is $\rho\mathbf{a}_\rho-z'\mathbf{a}_z$, and its magnitude is $\sqrt{\rho^2+z'^2}$. Integrating from $-\infty$ to $\infty$ sums the complete line. The axial part is an odd function of $z'$ and integrates to zero, while the radial part is even and survives. Evaluation gives a purely radial field whose magnitude decreases as $1/\rho$. This decay is slower than the $1/r^2$ field of a point charge because an infinite source continues to contribute charge as the observation radius grows. A tenfold increase in distance therefore reduces a line-charge field to one tenth, but reduces a point-charge field to one hundredth.

### Key planning details

- The differential source charge is $dQ=\rho_Ldz'$.
- The displacement is $\rho\mathbf{a}_\rho-z'\mathbf{a}_z$.
- The denominator is $(\rho^2+z'^2)^{3/2}$.
- The axial integrand has odd parity and integrates to zero.
- The radial field is proportional to $1/\rho$.
- The infinite-line field decays more slowly than a point-charge field.

### Source coverage

- The differential field is $$d\mathbf{E}=\frac{\rho_Ldz'(\rho\mathbf{a}_\rho-z'\mathbf{a}_z)}{4\pi\epsilon_0(\rho^2+z'^2)^{3/2}}.$$
- The integration extends over $-\infty<z'<\infty$.
- The substitution $z'=\rho\cot\theta$ is suggested for evaluating the surviving integral.
- Equation (16): $$\mathbf{E}=\frac{\rho_L}{2\pi\epsilon_0\rho}\mathbf{a}_\rho.$$
- The text compares the line field with an infinitely long fluorescent tube and the point field with a point light source.
- A finite line behaves approximately like an infinite line nearby and like a point source sufficiently far away.
