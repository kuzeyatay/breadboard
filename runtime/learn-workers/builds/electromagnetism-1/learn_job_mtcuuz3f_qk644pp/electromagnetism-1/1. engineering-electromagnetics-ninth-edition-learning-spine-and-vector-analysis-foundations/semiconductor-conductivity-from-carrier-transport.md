---
title: "1.75 Semiconductor Conductivity from Carrier Transport"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 155", "Chapter 5 Problems 5.24 through 5.26"]
related: ["charge-continuity-and-current-flux-tasks", "conduction-resistance-in-nonuniform-geometries"]
---

# 1.75 Semiconductor Conductivity from Carrier Transport

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 155, Chapter 5 Problems 5.24 through 5.26

Problems 5.24 through 5.26 connect microscopic carrier populations to macroscopic conductivity and resistance. Both electrons and holes contribute to conduction, so their contributions must be added using their number densities, charge magnitude, and mobilities. The exercises provide electron and hole mobilities and concentrations for intrinsic germanium, temperature-dependent carrier densities and mobilities for pure silicon, and a finite semiconductor sample with unequal electron and hole densities. The silicon task requires conversion from Celsius to kelvin before evaluating the supplied exponential and power-law expressions. Once conductivity is known, the sample resistance follows from its length and cross-sectional area. These problems provide a reusable sequence: calculate each carrier's conductivity contribution, sum the contributions, apply any temperature dependence carefully, and then use the geometry to convert conductivity to resistance.

## Page-Grounded Details

#### Page 155

$y=2$. (a) Let $V=0$ at the plane $y=0$, and find $V$ at $P(1,2,0)$. (b) Find E at P.

5.22 The line segment $x=0,-1\leq y\leq1$, $z=1$, carries a linear charge density $\rho_{L}=x|y|\mu C/m$. Let $z=0$ be a conducting plane, and determine the surface charge density at: (a) (0,0,0); (b) (0,1,0).

5.23 A dipole with $\mathbf{p}=0.1\mathbf{a}_{z}\mu C\cdot m$ is located at $A(1,0,0)$ in free space, and the $x=0$ plane is perfectly conducting. (a) Find $V$ at $P(2,0,1)$. (b) Find the equation of the 200 V equipotential surface in rectangular coordinates.

5.24 At a certain temperature, the electron and hole mobilities in intrinsic germanium are given as 0.43 and $0.21 m^{2}/V\cdot s$, respectively. If the electron and hole concentrations are both $2.3\times 10^{19}m^{-3}$, find the conductivity at this temperature.

5.25 Electron and hole concentrations increase with temperature. For pure silicon, suitable expressions are $\rho_{h}=-\rho_{e}=6200T^{1.5}e^{-7000/T}C/m^{3}$. The functional dependence of the mobilities on temperature is given by $\mu_{h}=2.3\times 10^{5}T^{-2.7}m^{2}/V\cdot s$ and $\mu_{e}=2.1\times 10^{5}T^{-2.5}m^{2}/V\cdot s$, whe

[Truncated for analysis]

## Core Ideas

- Electron and hole conductivity contributions are additive.
- Carrier mobility converts electric field into average drift response.
- Carrier concentrations and mobilities may both depend strongly on temperature.
- Temperature formulas stated in kelvin require Celsius-to-kelvin conversion.
- Bulk conductivity is converted to sample resistance using specimen geometry.

## Source Anchors

- Problem 5.24 gives germanium mobilities of 0.43 and 0.21 m$^2$/(V s) with equal carrier concentrations of $2.3\times10^{19}$ m$^{-3}$.
- Problem 5.25 gives $\rho_h=-\rho_e=6200T^{1.5}e^{-7000/T}$ C/m$^3$.
- Problem 5.25 gives $\mu_h=2.3\times10^5T^{-2.7}$ and $\mu_e=2.1\times10^5T^{-2.5}$ m$^2$/(V s).
- Problem 5.25 requests conductivity at $0^\circ$C, $40^\circ$C, and $80^\circ$C.
- Problem 5.26 gives a rectangular semiconductor sample and asks for resistance between its end faces.

## Related Pages

- [[charge-continuity-and-current-flux-tasks|Charge Continuity and Current-Flux Tasks]]
- [[conduction-resistance-in-nonuniform-geometries|Conduction Resistance in Nonuniform Geometries]]

## Concept Dependencies

- applies-to: [[conduction-resistance-in-nonuniform-geometries|Conduction Resistance in Nonuniform Geometries]]
