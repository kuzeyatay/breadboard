---
title: "1.140 Permanent Magnetization and Equivalent Magnetic Sources"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 290"]
related: ["magnetization-magnetic-materials-and-bound-currents", "maxwell-equations-and-supporting-constitutive-relations"]
---

# 1.140 Permanent Magnetization and Equivalent Magnetic Sources

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 290

Problem 8.45 develops potential equations for regions containing permanent magnetization but no free current. Starting with the scalar magnetic potential definition $\mathbf{H}=-\nabla V_m$ and the material relation involving magnetization, the problem introduces an equivalent magnetic charge density
$$
\rho_m=-\mu_0\nabla\cdot\mathbf{M}
$$
 The scalar potential then satisfies the Poisson equation
$$
\nabla^2V_m=-\frac{\rho_m}{\mu_0}
$$
 If $\mathbf{M}$ is uniform, its divergence vanishes within the volume, so there is no equivalent volume magnetic charge there, although boundaries may still require separate treatment. A complementary vector-potential description begins with $\mathbf{B}=\nabla\times\mathbf{A}$. In a zero-free-current region with permanent magnetization, the source asks for
$$
\nabla\times\nabla\times\mathbf{A}=\mu_0\mathbf{J}_{eq}
$$
 where
$$
\mathbf{J}_{eq}=\nabla\times\mathbf{M}
$$
 These two representations connect permanent magnets to mathematically equivalent source models: divergence of magnetization acts like a magnetic-charge source for scalar potential, while curl of magnetization acts like an equivalent current source for vector potential.

## Page-Grounded Details

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

- The scalar magnetic potential is defined by $\mathbf{H}=-\nabla V_m$ in the stated zero-current setting.
- Equivalent magnetic charge density is $\rho_m=-\mu_0\nabla\cdot\mathbf{M}$.
- The magnetic scalar potential satisfies $\nabla^2V_m=-\rho_m/\mu_0$.
- Uniform volume magnetization has zero divergence within the material.
- The vector magnetic potential is defined by $\mathbf{B}=\nabla\times\mathbf{A}$.
- Equivalent magnetization current is $\mathbf{J}_{eq}=\nabla\times\mathbf{M}$.
- Scalar and vector potential models expose complementary source properties of magnetization.

## Source Anchors

- Problem 8.45(a) begins with $\mathbf{H}=-\nabla V_m$.
- The stated Poisson equation is $\nabla^2V_m=-\rho_m/\mu_0$.
- The equivalent magnetic charge density is defined as $\rho_m=-\mu_0\nabla\cdot\mathbf{M}$.
- Problem 8.45 asks what occurs when $\mathbf{M}$ is uniform.
- Problem 8.45(b) begins with $\mathbf{B}=\nabla\times\mathbf{A}$.
- The equivalent current density is given as $\mathbf{J}_{eq}=\nabla\times\mathbf{M}$.

## Related Pages

- [[magnetization-magnetic-materials-and-bound-currents|Magnetization, Magnetic Materials, and Bound Currents]]
- [[maxwell-equations-and-supporting-constitutive-relations|Maxwell Equations and Supporting Constitutive Relations]]

## Concept Dependencies

- depends-on: [[magnetization-magnetic-materials-and-bound-currents|Magnetization, Magnetic Materials, and Bound Currents]]
