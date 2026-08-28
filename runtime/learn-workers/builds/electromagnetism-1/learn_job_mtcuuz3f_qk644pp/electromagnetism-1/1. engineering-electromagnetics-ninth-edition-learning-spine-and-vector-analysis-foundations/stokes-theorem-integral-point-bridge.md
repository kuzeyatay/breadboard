---
title: "1.117 Stokes' Theorem as the Integral-to-Point Bridge"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 216", "Section 7.4: Stokes' Theorem"]
related: ["curl-circulation-per-unit-area", "point-form-of-amperes-law", "ampere-circuital-law-enclosed-current"]
---

# 1.117 Stokes' Theorem as the Integral-to-Point Bridge

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 216, Section 7.4: Stokes' Theorem

Stokes' theorem provides the mathematical bridge between the point form and integral form of Ampere's law. The source begins with a surface $S$ divided into small areas $\Delta S$. For each small element, the curl definition gives approximately
$$
\frac{\oint\mathbf{H}\cdot d\mathbf{L}_{\Delta S}}{\Delta S}\approx(\nabla\times\mathbf{H})\cdot\mathbf{a}_N
$$
or
$$
\oint\mathbf{H}\cdot d\mathbf{L}_{\Delta S}\approx(\nabla\times\mathbf{H})\cdot\Delta\mathbf{S}
$$
The normal $\mathbf{a}_N$ is the right-hand normal associated with the orientation of the incremental boundary. The next step, begun at the end of this chunk, is to sum these circulations over every small surface element. Contributions along shared internal edges cancel because neighboring elements traverse each common edge in opposite directions. In the limiting sum, only the circulation around the outer boundary remains, connecting a boundary line integral with a surface integral of curl. This allows $\nabla\times\mathbf{H}=\mathbf{J}$ and $\oint\mathbf{H}\cdot d\mathbf{L}=I_{\mathrm{encl}}$ to be obtained from one another.

## Page-Grounded Details

#### Page 216

D7.4. (a) Evaluate the closed line integral of H about the rectangular path $P_{1}(2, 3, 4)$ to $P_{2}(4, 3, 4)$ to $P_{3}(4, 3, 1)$ to $P_{4}(2, 3, 1)$ to $P_{1}$, given $H=3z\mathbf{a}_{x}-2x^{3}\mathbf{a}_{z}$ A/m. (b) Determine the quotient of the closed line integral and the area enclosed by the path as an approximation to $(\nabla\times H)_{y}$. (c) Determine $(\nabla\times H)_{y}$ at the center of the area.

Answer. (a) 354 A; (b) 59 $A/m^{2}$; (c) 57 $A/m^{2}$

D7.5. Calculate the value of the vector current density: (a) in rectangular coordinates at $P_{A}(2, 3, 4)$ if $H=x^{2}z\mathbf{a}_{y}-y^{2}x\mathbf{a}_{z}$; (b) in cylindrical coordinates at $P_{B}(1.5, 90^{\circ}, 0.5)$ if $H=\frac{2}{\rho}(\cos0.2\phi)\mathbf{a}_{\rho}$; (c) in spherical coordinates at $P_{C}(2, 30^{\circ}, 20^{\circ})$ if $H=\frac{1}{\sin\theta}\mathbf{a}_{\theta}$.

Answer. (a) $-16\mathbf{a}_{x}+9\mathbf{a}_{y}+16\mathbf{a}_{z}$ A/m^2; (b) 0.055$\mathbf{a}_{z}$ A/m^2; (c) $\mathbf{a}_{\phi}$ A/m^2

#### 7.4 STOKES' THEOREM

Although Section 7.3 was devoted primarily to a discussion of the curl operation, the contribution to the subject of magnetic fields sh

[Truncated for analysis]

## Core Ideas

- Stokes' theorem links a boundary circulation to a surface integral of curl.
- The surface is partitioned into incremental areas.
- Each incremental circulation approximates curl dotted with the area vector.
- Boundary orientation and area normal obey the right-hand rule.
- Shared internal-edge contributions cancel in the surface sum.
- The theorem converts between point and integral forms of Ampere's law.
- The derivation begins in this chunk and continues beyond Page 216.

## Source Anchors

- Page 216 states that Stokes' theorem can recover Ampere's circuital law from $\nabla\times\mathbf{H}=\mathbf{J}$.
- Page 216 introduces a surface $S$ divided into incremental surfaces of area $\Delta S$.
- Page 216 writes $\oint\mathbf{H}\cdot d\mathbf{L}_{\Delta S}/\Delta S\approx(\nabla\times\mathbf{H})_N$.
- Page 216 rewrites the normal component as $(\nabla\times\mathbf{H})\cdot\mathbf{a}_N$.
- Page 216 obtains $\oint\mathbf{H}\cdot d\mathbf{L}_{\Delta S}\approx(\nabla\times\mathbf{H})\cdot\Delta\mathbf{S}$.
- The final paragraph on Page 216 begins summing the circulation over all incremental areas and introduces cancellation.

## Related Pages

- [[curl-circulation-per-unit-area|Curl as Circulation per Unit Area]]
- [[point-form-of-amperes-law|Point Form of Ampere's Law]]
- [[ampere-circuital-law-enclosed-current|Ampere's Circuital Law and Enclosed Current]]

## Concept Dependencies

- depends-on: [[curl-circulation-per-unit-area|Curl as Circulation per Unit Area]]
- applies-to: [[point-form-of-amperes-law|Point Form of Ampere's Law]]
- enables: [[ampere-circuital-law-enclosed-current|Ampere's Circuital Law and Enclosed Current]]
