---
title: "1.135 Magnetization, Magnetic Materials, and Bound Currents"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 286", "Page 287", "Page 288"]
related: ["magnetic-material-interfaces-and-spatially-varying-permeability", "magnetic-circuits-reluctance-and-air-gaps", "permanent-magnetization-and-equivalent-magnetic-sources", "maxwell-equations-and-supporting-constitutive-relations"]
---

# 1.135 Magnetization, Magnetic Materials, and Bound Currents

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 286, Page 287, Page 288

The magnetic-material problems connect macroscopic field quantities $\mathbf{B}$, $\mathbf{H}$, and $\mathbf{M}$ with permeability, susceptibility, atomic dipole moments, and bound currents. For a linear isotropic material, $\mathbf{M}=\chi_m\mathbf{H}$, $\mathbf{B}=\mu\mathbf{H}$, and $\mu_r=1+\chi_m$, with $\mu=\mu_0\mu_r$. Magnetization may also be computed as magnetic dipole moment per unit volume when the source supplies the number of atoms per cubic meter and the dipole moment of each atom. Spatially varying magnetization produces equivalent bound volume current through $\mathbf{J}_B=\nabla\times\mathbf{M}$, while discontinuities at material surfaces produce bound surface current related to the cross product of magnetization and the surface normal. The problems ask students to distinguish conduction current, bound current, and total current and to recover field quantities from several different combinations of given data. They also emphasize that ferromagnetic materials can sometimes be approximated as linear below the knee of a magnetization curve, although this is an approximation rather than a universal material law.

## Page-Grounded Details

#### Page 286

8.15  A solid conducting filament extends from $x=-b$ to $x=b$ along the line $y=2,z=0$. This filament carries a current of 3 A in the $a_{x}$ direction. An infinite filament on the $z$ axis carries 5 A in the $a_{z}$ direction. Obtain an expression for the torque exerted on the finite conductor about an origin located at $(0,2,0)$.

8.16  Assume that an electron is describing a circular orbit of radius $a$ about a positively charged nucleus. (a) By selecting an appropriate current and area, show that the equivalent orbital dipole moment is $ea^{2}\omega/2$, where $\omega$ is the electron's angular velocity. (b) Show that the torque produced by a magnetic field parallel to the plane of the orbit is $ea^{2}\omega B/2$. (c) By equating the Coulomb and centrifugal forces, show that $\omega$ is $(4\pi\epsilon_{0}m_{e}a^{3}/e^{2})^{-1/2}$, where $m_{e}$ is the electron mass. (d) Find values for the angular velocity, torque, and the orbital magnetic moment for a hydrogen atom, where $a$ is about $6\times 10^{-11}$ m; let $B=0.5$ T.

8.17  The hydrogen atom described in Problem 8.16 is now subjected to a magnetic field having the same direction as that of

[Truncated for analysis]

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

## Core Ideas

- For a linear isotropic magnetic material, $\mathbf{M}=\chi_m\mathbf{H}$.
- Relative permeability and susceptibility satisfy $\mu_r=1+\chi_m$.
- Magnetic flux density satisfies $\mathbf{B}=\mu\mathbf{H}$ in a linear material.
- Aligned atomic dipole moments give magnetization equal to dipole moment per unit volume.
- Nonuniform magnetization can be represented by an equivalent bound volume current.
- Surface discontinuities in magnetization can produce bound surface current.
- Conduction, bound, and total current densities must be distinguished in material calculations.

## Source Anchors

- Problem 8.19 gives $\chi_m=3.1$ and $\mathbf{B}=0.4y\mathbf{a}_z\ \mathrm{T}$ and asks for $\mathbf{H}$, $\mu$, $\mu_r$, $\mathbf{M}$, and several current densities.
- Problem 8.20 combines atomic dipole density, specified magnetization, permeability, susceptibility, magnetic flux density, and bound surface currents.
- Problem 8.21 asks for magnetization from $B$, from $H$ and $\mu_r$, and from atomic dipole data.
- Problem 8.22 assumes a linear ferromagnetic approximation with $\mu_r=1000$ for a current-carrying cylindrical wire.
- Problem 8.28 approximates the silicon-steel magnetization curve below its knee by $\mu=5\ \mathrm{mH/m}$.
- Problem 8.29 replaces the linear approximation with the actual silicon-steel magnetization curve.

## Related Pages

- [[magnetic-material-interfaces-and-spatially-varying-permeability|Magnetic Material Interfaces and Spatially Varying Permeability]]
- [[magnetic-circuits-reluctance-and-air-gaps|Magnetic Circuits, Reluctance, and Air Gaps]]
- [[permanent-magnetization-and-equivalent-magnetic-sources|Permanent Magnetization and Equivalent Magnetic Sources]]
- [[maxwell-equations-and-supporting-constitutive-relations|Maxwell Equations and Supporting Constitutive Relations]]

## Concept Dependencies

- applies-to: [[magnetic-material-interfaces-and-spatially-varying-permeability|Magnetic Material Interfaces and Spatially Varying Permeability]]
- enables: [[permanent-magnetization-and-equivalent-magnetic-sources|Permanent Magnetization and Equivalent Magnetic Sources]]
