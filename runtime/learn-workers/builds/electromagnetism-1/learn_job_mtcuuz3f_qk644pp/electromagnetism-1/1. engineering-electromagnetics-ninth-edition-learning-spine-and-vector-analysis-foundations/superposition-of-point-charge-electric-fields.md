---
title: "1.37 Superposition of Point-Charge Electric Fields"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 44", "Page 45", "Section: Example 2.2"]
related: ["electric-field-integral-for-a-volume-charge-distribution", "multipoles-finite-charge-distributions-and-far-field-limits", "electric-flux-density-from-charge"]
---

# 1.37 Superposition of Point-Charge Electric Fields

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 44, Page 45, Section: Example 2.2

The electric field produced by several point charges is the vector sum of the individual Coulomb fields. For a field point at position $\mathbf{r}$ and a charge $Q_m$ at source position $\mathbf{r}_m$, the displacement from source to field point is $\mathbf{r}-\mathbf{r}_m$. Its magnitude determines the inverse-square factor, while its normalized form supplies the field direction. Thus each contribution must be resolved as a vector before the contributions are added. Example 2.2 applies this process to four identical charges in the $z=0$ plane and a field point at $P(1,1,1)$. The unequal source-to-field distances prevent complete cancellation, even though the source geometry is symmetric. The example demonstrates the reusable procedure of constructing position vectors, computing displacements and distances, forming unit vectors, multiplying by Coulomb magnitudes, and finally summing Cartesian components.

## Page-Grounded Details

#### Page 44

If more charges are added at other positions, the field arising from $n$ point charges is
$$
E ( r ) = \sum _ { m = 1 } ^ { n } { \frac { Q _ { m } } { 4 \pi \epsilon  _ { 0 } | r - r _ { m } | ^ { 2 } } } a _ { m }
$$
(11)

#### EXAMPLE 2.2

In order to illustrate the application of (11), we find E at $P ( 1 , 1 , 1 )$ caused by four identical 3-nC (nanocoulomb) charges located at $P _ { 1 } ( 1 , 1 , 0 )$ , $P _ { 2 } ( - 1 , 1 , 0 )$ , $P _ { 3 } ( - 1 , - 1 , 0 )$ and $P _ { 4 } ( 1 , - 1 , 0 )$ , as shown in Figure 2.4.

*Solution.* We find that $r = {a}_{x} + {a}_{y} + {a}_{z}$ , $r _ { 1 } = {a}_{x} + {a}_{y}$ , and thus $r - r _ { 1 } = {a}_{z}$ . The magnitudes are: $\left| r - r _ { 1 } \right| = 1$ , $\left| r - r _ { 2 } \right| = \sqrt { 5 }$ , $\left| r - r _ { 3 } \right| = 3$ , and $\left| r - r _ { 4 } \right| = \sqrt { 5 }$ . Because $Q / 4 \pi \epsilon _ { 0 } = 3 \times 1 0 ^ { - 9 } / ( 4 \pi \times 8 . 8 5 4 \times 1 0 ^ { - 1 2 } ) = 2 6 . 9 6 V \cdot$ m , we may now use (11) to obtain
$$
E = 2 6 . 9 6 \left[ { \frac { a _ { z } } { 1 } \frac { 1 } { 1 ^ { 2 } } + \frac { 2 a _ { x } + a _ { z } } { \sqrt { 5 } } \frac { 1 } { (

[Truncated for analysis]

#### Page 45

D2.3. Evaluate the sums: (a) $\sum_{m=0}^{5}\frac{1+(-1)^{m}}{m^{2}+1}$; (b) $\sum_{m=1}^{4}\frac{(0.1)^{m}+1}{(4+m^{2})^{1.5}}$

Ans. (a) 2.52; (b) 0.176

#### 2.3 FIELD ARISING FROM A CONTINUOUS VOLUME CHARGE DISTRIBUTION

If we now visualize a region of space filled with a tremendous number of charges separated by minute distances, we see that we can replace this distribution of very small particles with a smooth continuous distribution described by a volume charge density, just as we describe water as having a density of 1 g/cm^3 (gram per cubic centimeter) even though it consists of atomic- and molecular-sized particles. This can be done only if we are uninterested in the small irregularities (or ripples) in the field as we move from electron to electron or if we care little that the mass of the water actually increases in small but finite steps as each new molecule is added.

This is really no limitation at all, because the end results for electrical engineers are almost always in terms of a current in a receiving antenna, a voltage in an electronic circuit, or a charge on a capacitor, or in general in terms of some large-scale macroscopic phenomenon. It is very seldom th

[Truncated for analysis]

## Core Ideas

- For $n$ charges, the total field is the vector sum of all individual fields.
- The source-to-field displacement for charge $m$ is $\mathbf{r}-\mathbf{r}_m$.
- Each contribution has inverse-square magnitude and points along the corresponding displacement unit vector.
- Vector components must be summed after each contribution is expressed in a common coordinate basis.
- Geometric symmetry can simplify a sum, but cancellation must be checked component by component.

## Source Anchors

- Equation (11):
$$
\mathbf{E}(\mathbf{r})=\sum_{m=1}^{n}\frac{Q_m}{4\pi\epsilon_0|\mathbf{r}-\mathbf{r}_m|^2}\mathbf{a}_m.$$
- Example 2.2 places four identical $3\,\mathrm{nC}$ charges at $(1,1,0)$, $(-1,1,0)$, $(-1,-1,0)$, and $(1,-1,0)$.
- For $P(1,1,1)$, the four source distances are $1$, $\sqrt{5}$, $3$, and $\sqrt{5}$.
- The example obtains $\mathbf{E}=6.82\mathbf{a}_x+6.82\mathbf{a}_y+32.8\mathbf{a}_z\,\mathrm{V/m}$.
- Source figure S1.P44.F1, Figure 2.4, depicts the four-charge geometry and the resulting field at $P$.
- Drill D2.2 applies the same procedure to two charges specified in centimeters and reports fields in $\mathrm{kV/m}$.

## Related Pages

- [[electric-field-integral-for-a-volume-charge-distribution|Electric Field Integral for a Volume Charge Distribution]]
- [[multipoles-finite-charge-distributions-and-far-field-limits|Multipoles, Finite Charge Distributions, and Far-Field Limits]]
- [[electric-flux-density-from-charge|Electric Flux Density from Charge]]

## Concept Dependencies

- enables: [[electric-field-integral-for-a-volume-charge-distribution|Electric Field Integral for a Volume Charge Distribution]]
- applies-to: [[multipoles-finite-charge-distributions-and-far-field-limits|Multipoles, Finite Charge Distributions, and Far-Field Limits]]
