---
title: "1.137 Magnetic Circuits, Reluctance, and Air Gaps"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 287", "Page 288", "Page 289"]
related: ["magnetization-magnetic-materials-and-bound-currents", "magnetic-material-interfaces-and-spatially-varying-permeability", "self-inductance-mutual-inductance-and-flux-linkage", "magnetic-energy-and-transmission-line-inductance"]
---

# 1.137 Magnetic Circuits, Reluctance, and Air Gaps

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 287, Page 288, Page 289

The magnetic-circuit problems treat cores, toroids, coils, and air gaps using magnetomotive force, reluctance, and flux. For a segment of approximately uniform field, reluctance is represented by $\mathcal{R}=\ell/(\mu A)$, where $\ell$ is magnetic path length, $\mu$ is permeability, and $A$ is cross-sectional area. The applied magnetomotive force is $NI$, and the circuit relation is analogous to a series network: flux is obtained from magnetomotive force divided by total reluctance. An air gap can dominate the total reluctance because its permeability is much lower than that of a ferromagnetic core, even when the gap is short. Composite cores require the correct series or parallel combination of flux paths and attention to different cross-sectional areas. The source contrasts infinite-permeability, fixed linear-permeability, and nonlinear silicon-steel models. It also asks students to start from Ampère's circuital law and integrate a position-dependent field over a rectangular core cross section, showing where a lumped magnetic-circuit approximation comes from and when a direct field calculation is more accurate.

## Page-Grounded Details

#### Page 287

8.20 (107,88),(154,107)Find H in a material where (a) $\mu_{r}=4.2$, there are $2.7\times 10^{29}$ atoms/m^3, and each atom has a dipole moment of $2.6\times 10^{-30}a_{y}$ A*m^2; (b) M= 270aₓ A/m and $\mu=2$ $\mu$H/m; (c) $\chi_{m}=0.7$ and B= 2aₓ T. (d) Find M in a material where bound surface current densities of 12aₓ A/m and -9aₓ A/m exist at $\rho=0.3$ m and 0.4 m, respectively.

8.21 (107,188),(154,206)Find the magnitude of the magnetization in a material for which (a) the magnetic flux density is 0.02 Wb/m^2; (b) the magnetic field intensity is 1200 A/m and the relative permeability is 1.005; (c) there are $7.2\times 10^{28}$ atoms per cubic meter, each having a dipole moment of $4\times 10^{-30}$ A*m^2 in the same direction, and the magnetic susceptibility is 0.003.

8.22 (107,286),(154,305)Under some conditions, it is possible to approximate the effects of ferromagnetic materials by assuming linearity in the relationship of B and H. Let $\mu_{r}=1000$ for a certain material of which a cylindrical wire of radius 1 mm is made. If I= 1 A and the current distribution is uniform, find (a) B, (b) H, (c) M, (d) J, and (e) J$_{B}$ within the wire.

8.23 (107,

[Truncated for analysis]

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

## Core Ideas

- Magnetomotive force is supplied by a winding as $NI$.
- A uniform magnetic segment has reluctance $\mathcal{R}=\ell/(\mu A)$.
- Flux is determined by magnetomotive force divided by total reluctance.
- Series magnetic segments carry common flux when leakage is neglected.
- A short air gap may dominate total reluctance because air has low permeability.
- Different core areas produce different flux densities for the same flux.
- Nonlinear magnetic materials require a magnetization curve rather than one fixed permeability.

## Source Anchors

- S1.P288.F8.16 shows the core geometry for Problem 8.28, including outer legs, a central leg, a coil, and an optional $0.3\ \mathrm{mm}$ air gap.
- Problem 8.28 gives outer-leg areas of $1.6\ \mathrm{cm^2}$, central-leg area of $2.5\ \mathrm{cm^2}$, specified path lengths, and a 1200-turn coil carrying $12\ \mathrm{mA}$.
- Problem 8.29 asks for current using the silicon-steel magnetization curve after a linear estimate gives $B=0.666\ \mathrm{T}$.
- Problem 8.31 gives a toroidal magnetic path, an air gap, an applied mmf of $200\ \mathrm{A\cdot turn}$, and three material models.
- S1.P289.F8.17 supports Problem 8.35's cone-sphere current-return geometry and its energy and inductance calculations.

## Related Pages

- [[magnetization-magnetic-materials-and-bound-currents|Magnetization, Magnetic Materials, and Bound Currents]]
- [[magnetic-material-interfaces-and-spatially-varying-permeability|Magnetic Material Interfaces and Spatially Varying Permeability]]
- [[self-inductance-mutual-inductance-and-flux-linkage|Self-Inductance, Mutual Inductance, and Flux Linkage]]
- [[magnetic-energy-and-transmission-line-inductance|Magnetic Energy and Transmission-Line Inductance]]

## Concept Dependencies

- depends-on: [[magnetization-magnetic-materials-and-bound-currents|Magnetization, Magnetic Materials, and Bound Currents]]
- enables: [[self-inductance-mutual-inductance-and-flux-linkage|Self-Inductance, Mutual Inductance, and Flux Linkage]]
