---
title: "1.139 Magnetic Energy and Transmission-Line Inductance"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 288", "Page 289", "Page 290"]
related: ["self-inductance-mutual-inductance-and-flux-linkage", "magnetic-circuits-reluctance-and-air-gaps", "magnetic-force-and-torque-on-charges-and-currents"]
---

# 1.139 Magnetic Energy and Transmission-Line Inductance

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 288, Page 289, Page 290

A major group of Chapter 8 problems derives inductance from stored magnetic energy. For a linear medium, the magnetic energy density is integrated over the field-containing volume, and the resulting total energy is equated to
$$
W_H=\frac{1}{2}LI^2
$$
 This provides a reusable path to inductance when the magnetic field is known more easily than the linked flux. The source applies this approach to coaxial lines, cylindrical wires, parallel conducting planes, two-wire lines, toroids, and a cone-sphere structure. Internal inductance arises from magnetic field inside a current-carrying conductor, so it depends on the current distribution. External inductance comes from field outside conductors and commonly produces logarithmic expressions after integrating a $1/\rho$ magnetic field. Composite dielectric or magnetic fillings are handled by dividing the field region into subregions and adding their energy or flux contributions. Problem 8.39 deliberately asks for planar-line inductance by both stored energy and flux, providing a consistency check between two definitions. Problem 8.43 similarly uses energy to establish the internal inductance of a uniformly conducting nonmagnetic wire.

## Page-Grounded Details

#### Page 288

Figure 8.16 See Problem 8.28.

8.29

In Problem 8.28, the linear approximation suggested in the statement of the problem leads to flux density of 0.666 T in the central leg. Using this value of B and the magnetization curve for silicon steel, what current is required in the 1200-turn coil?

8.30

A rectangular core has fixed permeability $\mu_{r}>>1$, a square cross section of dimensions $a\times a$, and has centerline dimensions around its perimeter of b and d. Coils 1 and 2, having turn numbers $N_{1}$ and $N_{2}$, are wound on the core. Consider a selected core cross-sectional plane as lying within the xy plane, such that the surface is defined by $0<x<a$, $0<y<a$. (a) With current $I_{1}$ in coil 1, use Ampere's circuital law to find the magnetic flux density as a function of position over the core cross section. (b) Integrate your result of part (a) to determine the total magnetic flux within the core. (c) Find the self-inductance of coil 1. (d) Find the mutual inductance between coils 1 and 2.

8.31

A toroid is constructed of a magnetic material having a cross-sectional area of $2.5\text{ cm}^{2}$ and an effective length of 8 cm. There is also a short air gap

[Truncated for analysis]

#### Page 289

Figure 8.17 See Problem 8.35.

8.34

Determine the energy stored per unit length in the internal magnetic field of an infinitely long, straight wire of radius a, carrying uniform current I.

8.35

The cones $\theta=21^{\circ}$ and $\theta=159^{\circ}$ are conducting surfaces and carry total currents of 40 A, as shown in Figure 8.17. The currents return on a spherical conducting surface of 0.25 m radius. (a) Find H in the region $0<r<0.25$, $21^{\circ}<\theta<159^{\circ}$, $0<\phi<2\pi$. (b) How much energy is stored in this region? (c) Find the inductance of the cone-sphere configuration. The inductance is that offered at the origin between the vertices of the cone.

8.36

The dimensions of the outer conductor of a coaxial cable are b and c, where $c>b$. Assuming $\mu=\mu_{0}$, find the magnetic energy stored per unit length in the region $b<\rho<c$ for a uniformly distributed total current I flowing in opposite directions in the inner and outer conductors.

8.37

A toroid has known reluctance $\mathcal{R}$. Two windings having $N_{1}$ and $N_{2}$ turns are present. Find (a) the self-inductances of the two coils; (b) the mutual inductance between the coils.

8

[Truncated for analysis]

#### Page 290

rectangle $0<x<1$, $0<z<d$, in the plane $y=0$, and from this result again find the inductance per unit length.

8.40

A coaxial cable has conductor radii $a$ and $b$, where $a<b$. Material of permeability $\mu_{r}\neq 1$ exists in the region $a<\rho<c$, whereas the region $c<\rho<b$ is air filled. Find an expression for the inductance per unit length.

8.41

A rectangular coil is composed of 150 turns of a filamentary conductor. Find the mutual inductance in free space between this coil and an infinite straight filament on the $z$ axis if the four corners of the coil are located at: (a) (0, 1, 0), (0, 3, 0), (0, 3, 1), and (0, 1, 1); (b) (1, 1, 0), (1, 3, 0), (1, 3, 1), and (1, 1, 1).

8.42

Find the mutual inductance between two filaments forming circular rings of radii $a$ and $\Delta a$, where $\Delta a\ll a$. The field should be determined by approximate methods. The rings are coplanar and concentric.

8.43

(a) Use energy relationships to show that the internal inductance of a nonmagnetic cylindrical wire of radius $a$ carrying a uniformly distributed current $I$ is $\mu_{0}/(8\pi)$ H/m. (b) Find the internal inductance if the portion of the co

[Truncated for analysis]

## Core Ideas

- Linear magnetic energy is related to inductance by $W_H=\frac{1}{2}LI^2$.
- Energy density must be integrated over every region containing magnetic field.
- Internal inductance is produced by magnetic field inside a conductor.
- Internal inductance depends on current distribution and conductor geometry.
- External inductance often follows from integrating a circumferential field proportional to $1/\rho$.
- Piecewise permeability requires separate regional contributions.
- Energy and flux-linkage methods should produce the same inductance.

## Source Anchors

- Problem 8.32 asks for magnetic energy and inductance per unit length of a coaxial transmission line filled with material of relative permeability $\mu_r$.
- Problem 8.34 asks for energy stored per unit length inside a uniformly conducting straight wire.
- Problem 8.36 asks for magnetic energy in the outer conductor region $b<\rho<c$ of a coaxial cable.
- Problem 8.39 derives planar transmission-line inductance first from energy and then from total magnetic flux.
- Problem 8.40 divides a coaxial cable into a magnetic region $a<\rho<c$ and an air region $c<\rho<b$.
- Problem 8.43 states the uniform-wire internal inductance result $\mu_0/(8\pi)\ \mathrm{H/m}$.
- Problem 8.44 gives the approximate two-wire external inductance $(\mu/\pi)\ln(d/a)\ \mathrm{H/m}$.

## Related Pages

- [[self-inductance-mutual-inductance-and-flux-linkage|Self-Inductance, Mutual Inductance, and Flux Linkage]]
- [[magnetic-circuits-reluctance-and-air-gaps|Magnetic Circuits, Reluctance, and Air Gaps]]
- [[magnetic-force-and-torque-on-charges-and-currents|Magnetic Force and Torque on Charges and Currents]]

## Concept Dependencies

- derives-from: [[self-inductance-mutual-inductance-and-flux-linkage|Self-Inductance, Mutual Inductance, and Flux Linkage]]
