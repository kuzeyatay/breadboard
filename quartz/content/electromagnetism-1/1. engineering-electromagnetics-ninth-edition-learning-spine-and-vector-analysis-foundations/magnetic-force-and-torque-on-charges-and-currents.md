---
title: "1.133 Magnetic Force and Torque on Charges and Currents"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 284", "Page 285", "Page 286"]
related: ["orbital-magnetic-dipole-model", "maxwell-equations-and-supporting-constitutive-relations", "magnetic-energy-and-transmission-line-inductance"]
---

# 1.133 Magnetic Force and Torque on Charges and Currents

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 284, Page 285, Page 286

The Chapter 8 problems consolidate how electric and magnetic fields exert forces on moving charges and current-carrying conductors. A charge in combined fields is governed by the Lorentz force, with the electric contribution parallel to $\mathbf{E}$ and the magnetic contribution $Q\mathbf{v}\times\mathbf{B}$ perpendicular to both velocity and magnetic flux density. Because a magnetic force is perpendicular to velocity, it changes the direction of motion without directly changing kinetic energy. In a uniform magnetic field this produces circular motion, with the orbital period independent of orbit radius and an angular frequency determined by charge-to-mass ratio and magnetic flux density. For distributed currents, the same interaction is applied through differential current elements or surface current density and integrated to obtain force or torque. The problems cover forces between current strips, filaments, cylinders, transmission-line planes, loops, and solenoids. They also use $\boldsymbol{\tau}=\mathbf{m}\times\mathbf{B}$ for magnetic dipoles and current loops. These exercises form a reusable procedure: determine the source field, evaluate the local force density or differential force, integrate over the current distribution, and then compute torque about the specified origin when required.

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

#### Page 285

8.6

Show that the differential work in moving a current element $I\,d\mathbf{L}$ through a distance $d\mathbf{l}$ in a magnetic field $\mathbf{B}$ is the negative of that done in moving the element $I\,d\mathbf{l}$ through a distance $d\mathbf{L}$ in the same field.

8.7

A conducting strip of infinite length lies in the $xy$ plane with its length oriented along the $x$ axis, and where $-b/2<y<b/2$ defines its width along $y$. Current $I_{1}$ flows down the strip in the positive $x$ direction and is uniformly distributed over the width. Above the strip and parallel to it at $z=d$ is an infinitely long current filament that carries current $I_{2}$ in the positive $x$ direction. Find the force of attraction between the two currents per unit length in $x$. Assume $d<<b$.

8.8

Two conducting strips, having infinite length in the $z$ direction, lie in the $xz$ plane. One occupies the region $d/2<x<b+d/2$ and carries surface current density $\mathbf{K}=K_{0}\mathbf{a}_{z}$; the other is situated at $-(b+d/2)<x<-d/2$ and carries surface current density $-K_{0}\mathbf{a}_{z}$. (a) Find the force per unit length in $z$ that tends to separate t

[Truncated for analysis]

#### Page 286

8.15  A solid conducting filament extends from $x=-b$ to $x=b$ along the line $y=2,z=0$. This filament carries a current of 3 A in the $a_{x}$ direction. An infinite filament on the $z$ axis carries 5 A in the $a_{z}$ direction. Obtain an expression for the torque exerted on the finite conductor about an origin located at $(0,2,0)$.

8.16  Assume that an electron is describing a circular orbit of radius $a$ about a positively charged nucleus. (a) By selecting an appropriate current and area, show that the equivalent orbital dipole moment is $ea^{2}\omega/2$, where $\omega$ is the electron's angular velocity. (b) Show that the torque produced by a magnetic field parallel to the plane of the orbit is $ea^{2}\omega B/2$. (c) By equating the Coulomb and centrifugal forces, show that $\omega$ is $(4\pi\epsilon_{0}m_{e}a^{3}/e^{2})^{-1/2}$, where $m_{e}$ is the electron mass. (d) Find values for the angular velocity, torque, and the orbital magnetic moment for a hydrogen atom, where $a$ is about $6\times 10^{-11}$ m; let $B=0.5$ T.

8.17  The hydrogen atom described in Problem 8.16 is now subjected to a magnetic field having the same direction as that of

[Truncated for analysis]

## Core Ideas

- A moving point charge experiences $\mathbf{F}=Q(\mathbf{E}+\mathbf{v}\times\mathbf{B})$.
- The magnetic part of the Lorentz force is perpendicular to velocity and does no direct work on the charge.
- Uniform magnetic flux density produces circular charged-particle motion when velocity is perpendicular to $\mathbf{B}$.
- The cyclotron angular frequency depends on charge, mass, and magnetic flux density rather than orbit radius.
- Current-element forces are integrated over filaments, strips, sheets, cylinders, loops, or solenoids.
- Torque calculations require both the magnetic force and the position vector relative to the stated origin.
- Parallel currents attract, while oppositely directed currents repel in the standard filamentary geometry.

## Source Anchors

- Problem 8.1 asks for the trajectory, velocity, and kinetic energy of a charge moving in $\mathbf{E}=30\mathbf{a}_z\ \mathrm{V/m}$.
- Problem 8.3 uses combined vector fields $\mathbf{E}$ and $\mathbf{B}$ to determine the initial acceleration direction and kinetic energy.
- Problem 8.4 asks for proof of a circular orbit with radius-independent period and the electron cyclotron frequency.
- Problems 8.7 through 8.13 treat forces between strips, filaments, cylinders, rings, and planar conductors.
- Problems 8.14, 8.15, and 8.18 ask for torque on a solenoid, a finite conductor, and a square loop.
- S1.P286.F8.15 is the source-central square-loop geometry used by Problem 8.18 and should be retained as a visual opportunity for vector torque about point $A$.

## Related Pages

- [[orbital-magnetic-dipole-model|Orbital Magnetic Dipole Model]]
- [[maxwell-equations-and-supporting-constitutive-relations|Maxwell Equations and Supporting Constitutive Relations]]
- [[magnetic-energy-and-transmission-line-inductance|Magnetic Energy and Transmission-Line Inductance]]

## Concept Dependencies

- applies-to: [[orbital-magnetic-dipole-model|Orbital Magnetic Dipole Model]]
- related: [[maxwell-equations-and-supporting-constitutive-relations|Maxwell Equations and Supporting Constitutive Relations]]
