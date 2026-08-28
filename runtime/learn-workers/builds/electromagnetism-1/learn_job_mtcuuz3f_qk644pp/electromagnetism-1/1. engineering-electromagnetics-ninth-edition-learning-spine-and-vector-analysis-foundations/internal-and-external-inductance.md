---
title: "1.131 Internal and External Inductance"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 281", "Page 282", "Section 8.10.2"]
related: ["flux-linkage-and-self-inductance", "energy-and-vector-potential-definitions-of-inductance"]
---

# 1.131 Internal and External Inductance

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 281, Page 282, Section 8.10.2

Real conductors contain magnetic flux both outside and inside their material. External flux links the full enclosed current according to the geometry of the circuit, while internal flux links a fraction of the current that depends on position within the conductor. These internal linkages create an internal inductance that must be added to external inductance to obtain the total. For a long straight circular wire of radius $a$ with uniform current distribution, the internal inductance per unit length is $L_{int}=\mu/(8\pi)$ H/m. A conductor cannot be treated as an exact zero-radius filament when calculating self-inductance. Ampère's law makes the field near an ideal filament vary inversely with distance, and integrating the associated flux or energy down to zero radius produces an infinite result. Giving the wire a finite radius removes this singularity. Frequency also affects the current distribution. At high frequencies, current becomes concentrated near the surface, reducing internal flux and making internal inductance less significant. At lower frequencies, current penetrates more uniformly and internal inductance can form an appreciable part of the total.

## Page-Grounded Details

#### Page 281

in (56) becomes $I\,d\mathbf{L}$,
$$
L=\frac{1}{I}\oint\mathbf{A}\cdot d\mathbf{L}\qquad(59)
$$
For a small cross section, $d\mathbf{L}$ may be taken along the center of the filament. We now apply Stokes' theorem and obtain
$$
L=\frac{1}{I}\int_{S}(\nabla\times\mathbf{A})\cdot d\mathbf{S}
$$
or
$$
L=\frac{1}{I}\int_{S}\mathbf{B}\cdot d\mathbf{S}
$$
or
$$
L=\frac{\Phi}{I}\qquad(60)
$$
Retracing the steps by which (60) is obtained, we should see that the flux $\Phi$ is that portion of the total flux that passes through any and every open surface whose perimeter is the filamentary current path.

If we now let the filament make $N$ identical turns about the total flux, an ideali-zation that may be closely realized in some types of inductors, the closed line integral must consist of $N$ laps about this common path, and (60) becomes
$$
L=\frac{N\Phi}{I}\qquad(61)
$$
The flux $\Phi$ is now the flux crossing any surface whose perimeter is the path occupied by any _one_ of the $N$ turns. The inductance of an $N$-turn coil may still be obtained from (60), however, if we realize that the flux is that which crosses the complicated surface^4 whose perimeter consists of

[Truncated for analysis]

#### Page 282

In Chapter 11, we will see that the current distribution in a conductor at high frequencies tends to be concentrated near the surface. The internal flux is reduced, and it is usually sufficient to consider only the external inductance. At lower frequencies, however, internal inductance may become an appreciable part of the total inductance.

#### 8.10.3 Mutual Inductance

We conclude by defining the mutual inductance between circuits 1 and 2, $M_{12}$, in terms of mutual flux linkages,
$$
M_{12}=\frac{N_{2}\Phi_{12}}{I_{1}}\quad{(63)}
$$
where $\Phi_{12}$ signifies the flux produced by $I_{1}$ which links the path of the filamentary current $I_{2}$, and $N_{2}$ is the number of turns in circuit 2. The mutual inductance, therefore, depends on the magnetic interaction between two currents. With either current alone, the total energy stored in the magnetic field can be found in terms of a single inductance, or self-inductance; with both currents having nonzero values, the total energy is a function of the two self-inductances and the mutual inductance. In terms of a mutual energy, it can be shown that (63) is equivalent to
$$ M_{12}=\frac{1}{I_{1}I_{2}}\int_{\text{vol}}(B

[Truncated for analysis]

## Core Ideas

- Total self-inductance includes both internal and external contributions.
- Internal flux links different fractions of the total current at different radii.
- A uniform circular wire has $L_{int}=\mu/(8\pi)$ H/m.
- An ideal zero-radius filament has infinite self-inductance.
- The divergence follows from the inverse-distance magnetic field near the filament.
- A finite conductor radius removes the singularity.
- High-frequency surface-current concentration reduces internal flux.
- Internal inductance is more important when current penetrates the conductor cross section.

## Source Anchors

- Page 281 explains why a true zero-radius filament yields infinite energy, flux, and inductance.
- Equation (62) gives $L_{a,int}=\mu/(8\pi)$ H/m for a long circular wire with uniform current distribution.
- The source states that internal flux links a variable fraction of total current depending on location.
- Page 282 notes that high-frequency current tends to concentrate near the conductor surface.
- The reduction of internal flux at high frequency often permits use of external inductance alone.

## Related Pages

- [[flux-linkage-and-self-inductance|Flux Linkage and Self-Inductance]]
- [[energy-and-vector-potential-definitions-of-inductance|Energy and Vector-Potential Definitions of Inductance]]

## Concept Dependencies

- part-of: [[flux-linkage-and-self-inductance|Flux Linkage and Self-Inductance]]
- depends-on: [[energy-and-vector-potential-definitions-of-inductance|Energy and Vector-Potential Definitions of Inductance]]
