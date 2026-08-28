---
title: "1.138 Self-Inductance, Mutual Inductance, and Flux Linkage"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 284", "Page 288", "Page 289", "Page 290"]
related: ["magnetic-circuits-reluctance-and-air-gaps", "magnetic-energy-and-transmission-line-inductance", "faraday-induction-flux-linkage-and-lenzs-law"]
---

# 1.138 Self-Inductance, Mutual Inductance, and Flux Linkage

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 284, Page 288, Page 289, Page 290

The inductance problems connect current-generated magnetic flux to flux linkage. For a winding of $N$ turns linking flux $\Phi$, the flux linkage is $\lambda=N\Phi$, and self-inductance is obtained from $L=\lambda/I$ in a linear system. Mutual inductance measures the flux linkage of one coil caused by current in another, so $M=N_2\Phi_{21}/I_1$ for the flux through coil 2 produced by current $I_1$. When two windings share an ideal magnetic circuit of reluctance $\mathcal{R}$, the source asks students to show that $L_1=N_1^2/\mathcal{R}$, $L_2=N_2^2/\mathcal{R}$, and the fully coupled mutual inductance is $M=N_1N_2/\mathcal{R}$. Other problems require direct integration because the magnetic field varies over the core cross section or because the coupled objects are filaments and loops in free space. The coaxial-solenoid drill gives numerical self and mutual inductances and reinforces that mutual coupling is determined by shared flux rather than merely by physical proximity.

## Page-Grounded Details

#### Page 284

D8.13. A solenoid is 50 cm long, 2 cm in diameter, and contains 1500 turns. The cylindrical core has a diameter of 2 cm and a relative permeability of 75. This coil is coaxial with a second solenoid, also 50 cm long, but with a 3 cm diameter and 1200 turns. Calculate: (a) L for the inner solenoid; (b) L for the outer solenoid; (c) M between the two solenoids.

Ans. (a) 133.2 mH; (b) 192 mH; (c) 106.6 mH

#### REFERENCES

1. Kraus, J. D., and D. A. Fleisch. (See References for Chapter 3.) Examples of the calculation of inductance are given on pp. 99-108.

2. Matsch, L. W. (See References for Chapter 6.) Chapter 3 is devoted to magnetic circuits and ferromagnetic materials.

3. Paul, C. R., K. W. Whites, and S. Y. Nasar. (See References for Chapter 7.) Magnetic circuits, including those with permanent magnets, are discussed on pp. 263-70.

#### CHAPTER 8 PROBLEMS

8.1

A point charge, $Q=-0.3\ \mu C$ and $m=3\times 10^{-16}\ \text{kg}$, is moving through the field $\mathbf{E}=30\mathbf{a}_{z}\ \text{V/m}$. Use Eq. (1) and Newton's laws to develop the appropriate differential equations and solve them, subject to the initial conditions at $t=0$, $ \mathbf{v}=3\times 10^{5}\math

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

- Flux linkage is $\lambda=N\Phi$ for $N$ turns linking flux $\Phi$.
- Linear self-inductance is $L=\lambda/I$.
- Mutual inductance is the flux linkage in one winding per current in another.
- For a shared ideal magnetic circuit, inductance scales with the square of turn count.
- Fully shared flux gives $M=N_1N_2/\mathcal{R}$.
- Nonuniform fields require integration before flux linkage is computed.
- Reciprocal coil systems are expected to give the same mutual inductance under interchange of source and receiving coils.

## Source Anchors

- Drill D8.13 gives coaxial solenoids and answers $L_{inner}=133.2\ \mathrm{mH}$, $L_{outer}=192\ \mathrm{mH}$, and $M=106.6\ \mathrm{mH}$.
- Problem 8.30 asks for position-dependent core flux density, total flux, self-inductance, and mutual inductance.
- Problem 8.37 gives a toroid of known reluctance with windings $N_1$ and $N_2$ and asks for both self-inductances and mutual inductance.
- Problem 8.38 supplies a rectangular toroidal core with $\mu_r=80$ and windings of 1000 and 2500 turns.
- Problems 8.41 and 8.42 ask for mutual inductance between a rectangular coil and a straight filament and between nearly equal concentric circular rings.

## Related Pages

- [[magnetic-circuits-reluctance-and-air-gaps|Magnetic Circuits, Reluctance, and Air Gaps]]
- [[magnetic-energy-and-transmission-line-inductance|Magnetic Energy and Transmission-Line Inductance]]
- [[faraday-induction-flux-linkage-and-lenzs-law|Faraday Induction, Flux Linkage, and Lenz's Law]]

## Concept Dependencies

- applies-to: [[magnetic-circuits-reluctance-and-air-gaps|Magnetic Circuits, Reluctance, and Air Gaps]]
- related: [[magnetic-energy-and-transmission-line-inductance|Magnetic Energy and Transmission-Line Inductance]]
