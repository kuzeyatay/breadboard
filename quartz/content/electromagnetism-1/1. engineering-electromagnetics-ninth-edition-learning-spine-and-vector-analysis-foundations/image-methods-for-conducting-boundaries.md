---
title: "1.74 Image Methods for Conducting Boundaries"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 154", "Page 155", "Chapter 5 Problems 5.20 through 5.23"]
related: ["capacitance-as-a-charge-to-potential-ratio", "cylinder-to-plane-capacitance-by-equivalent-line-charges"]
---

# 1.74 Image Methods for Conducting Boundaries

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 154, Page 155, Chapter 5 Problems 5.20 through 5.23

Problems 5.20 through 5.23 apply electrostatic image methods to charges near perfect conducting planes. The central procedure replaces the conductor boundary with fictitious image charges chosen so that the prescribed conductor potential is satisfied. Once the equivalent free-space potential is constructed, the electric field follows from $\mathbf E=-\nabla V$. At the conductor surface, the normal electric flux density determines the induced surface charge density. Integrating this density over the plane gives the total induced charge. The tasks include a point charge over a grounded plane, two infinite line charges above a conducting plane, a finite line-charge segment, and an electric dipole next to a conducting plane. They require evaluating potentials and fields at specified points, determining local induced surface charge, and finding an equipotential surface. These examples teach that the image system is a mathematical replacement valid in the physical region outside the conductor, not an assertion that image charges physically exist inside the conductor.

## Page-Grounded Details

#### Page 154

Voltage $V_{0}$ is applied to the plate at $z=d$; the plate at $z=0$ is at zero potential. Find, in terms of the given parameters, (a) the electric field intensity E within the material; (b) the total current flowing between plates; (c) the resistance of the material.

5.15

A conducting medium is in the shape of a hemispherical shell, having inner and outer radii, a and b, respectively. The conductivity varies radially as $\sigma(r)=\sigma_{0}~{}a/r$ S/m, where $\sigma_{0}$ is a constant. The surfaces at $r=a$ and b are coated with silver (essentially infinite conductivity for this problem). The inner surface is raised to potential $V_{0}$; the outer surface is grounded. A radial current, $I_{0}$, flows between surfaces. (a) Find the current density, J, in terms of $I_{0}$. (b) Find E between surfaces in terms of $I_{0}$. (c) Find $V_{0}$ in terms of $I_{0}$. (d) Find the resistance R.

5.16

A coaxial transmission line has inner and outer conductor radii a and b. Between conductors ($a<\rho<b$) lies a conductive medium whose conductivity is $\sigma(\rho)=\sigma_{0}/\rho$, where $\sigma_{0}$ is a constant. The inner conductor is charged to potential $

[Truncated for analysis]

#### Page 155

$y=2$. (a) Let $V=0$ at the plane $y=0$, and find $V$ at $P(1,2,0)$. (b) Find E at P.

5.22 The line segment $x=0,-1\leq y\leq1$, $z=1$, carries a linear charge density $\rho_{L}=x|y|\mu C/m$. Let $z=0$ be a conducting plane, and determine the surface charge density at: (a) (0,0,0); (b) (0,1,0).

5.23 A dipole with $\mathbf{p}=0.1\mathbf{a}_{z}\mu C\cdot m$ is located at $A(1,0,0)$ in free space, and the $x=0$ plane is perfectly conducting. (a) Find $V$ at $P(2,0,1)$. (b) Find the equation of the 200 V equipotential surface in rectangular coordinates.

5.24 At a certain temperature, the electron and hole mobilities in intrinsic germanium are given as 0.43 and $0.21 m^{2}/V\cdot s$, respectively. If the electron and hole concentrations are both $2.3\times 10^{19}m^{-3}$, find the conductivity at this temperature.

5.25 Electron and hole concentrations increase with temperature. For pure silicon, suitable expressions are $\rho_{h}=-\rho_{e}=6200T^{1.5}e^{-7000/T}C/m^{3}$. The functional dependence of the mobilities on temperature is given by $\mu_{h}=2.3\times 10^{5}T^{-2.7}m^{2}/V\cdot s$ and $\mu_{e}=2.1\times 10^{5}T^{-2.5}m^{2}/V\cdot s$, whe

[Truncated for analysis]

## Core Ideas

- Image charges enforce a specified potential on a perfect conductor.
- The image configuration is used only to calculate the field in the physical region.
- The electric field is obtained from the gradient of the image-system potential.
- Surface charge density follows from the normal field immediately outside the conductor.
- Total induced charge is found by integrating the surface charge density.
- Image methods extend to point charges, line charges, and dipoles.

## Source Anchors

- Problem 5.20 places a point charge at $z=d$ over the infinite conducting plane $z=0$.
- Problem 5.20 asks for $\mathbf E$, $\mathbf D$, $\rho_s$, and total induced charge.
- Problem 5.21 uses two uniform infinite line charges of 30 nC/m above the plane $y=0$.
- Problem 5.22 asks for surface charge density produced by a finite line-charge segment above $z=0$.
- Problem 5.23 places $\mathbf p=0.1\mathbf a_z\,\mu\mathrm C\cdot\mathrm m$ next to the conducting plane $x=0$.

## Related Pages

- [[capacitance-as-a-charge-to-potential-ratio|Capacitance as a Charge-to-Potential Ratio]]
- [[cylinder-to-plane-capacitance-by-equivalent-line-charges|Cylinder-to-Plane Capacitance by Equivalent Line Charges]]

## Concept Dependencies

- enables: [[capacitance-as-a-charge-to-potential-ratio|Capacitance as a Charge-to-Potential Ratio]]
