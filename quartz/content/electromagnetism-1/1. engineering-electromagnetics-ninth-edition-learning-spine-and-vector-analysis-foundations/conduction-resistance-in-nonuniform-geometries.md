---
title: "1.73 Conduction Resistance in Nonuniform Geometries"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 153", "Page 154", "Chapter 5 Problems 5.8 through 5.19"]
related: ["charge-continuity-and-current-flux-tasks", "coaxial-and-spherical-capacitor-geometries", "series-and-parallel-multiple-dielectric-capacitors"]
---

# 1.73 Conduction Resistance in Nonuniform Geometries

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 153, Page 154, Chapter 5 Problems 5.8 through 5.19

Problems 5.8 through 5.19 form a sustained practice sequence on steady conduction through geometries with changing cross section or spatially varying conductivity. The core relations are $\mathbf J=\sigma\mathbf E$, voltage as a line integral of $\mathbf E$, and total current as the surface integral of $\mathbf J$. For a one-dimensional current path whose area or conductivity varies, a differential resistance can be written as $dR=d\ell/[\sigma(\ell)A(\ell)]$ and integrated as a series combination. If current paths occupy side-by-side differential regions under the same voltage, their differential conductances combine in parallel. The problems apply these ideas to a truncated cone, washer, coaxial cylinders, parallel plates, hollow tubes, hemispherical shells, and radially graded media. Several exercises explicitly request two derivations of the same resistance, first from field and current relations and then from differential shell combinations. This reinforces the physical distinction between series layers along the current direction and parallel paths distributed across the conducting area.

## Page-Grounded Details

#### Page 153

5.8

A truncated cone has a height of 16 cm. The circular faces on the top and bottom have radii of 2 mm and 0.1 mm, respectively. If the material from which this solid cone is constructed has a conductivity of $2\times 10^{6}$ S/m, use some good approximations to determine the resistance between the two circular faces.

5.9

(a) Using data tabulated in Appendix C, calculate the required diameter for a 2-m-long nichrome wire that will dissipate an average power of 450 W when 120 V rms at 60 Hz is applied to it. (b) Calculate the rms current density in the wire.

5.10

A large brass washer has a 2-cm inside diameter, a 5-cm outside diameter, and is 0.5 cm thick. Its conductivity is $\sigma=1.5\times 10^{7}$ S/m. The washer is cut in half along a diameter, and a voltage is applied between the two rectangular faces of one part. The resultant electric field in the interior of the half-washer is $\mathbf{E}=(0.5/\rho)\mathbf{a}_{\phi}$ V/m in cylindrical coordinates, where the z axis is the axis of the washer. (a) What potential difference exists between the two rectangular faces? (b) What total current is flowing? (c) What is the resistance between the two faces?

5.11

Two perfe

[Truncated for analysis]

#### Page 154

Voltage $V_{0}$ is applied to the plate at $z=d$; the plate at $z=0$ is at zero potential. Find, in terms of the given parameters, (a) the electric field intensity E within the material; (b) the total current flowing between plates; (c) the resistance of the material.

5.15

A conducting medium is in the shape of a hemispherical shell, having inner and outer radii, a and b, respectively. The conductivity varies radially as $\sigma(r)=\sigma_{0}~{}a/r$ S/m, where $\sigma_{0}$ is a constant. The surfaces at $r=a$ and b are coated with silver (essentially infinite conductivity for this problem). The inner surface is raised to potential $V_{0}$; the outer surface is grounded. A radial current, $I_{0}$, flows between surfaces. (a) Find the current density, J, in terms of $I_{0}$. (b) Find E between surfaces in terms of $I_{0}$. (c) Find $V_{0}$ in terms of $I_{0}$. (d) Find the resistance R.

5.16

A coaxial transmission line has inner and outer conductor radii a and b. Between conductors ($a<\rho<b$) lies a conductive medium whose conductivity is $\sigma(\rho)=\sigma_{0}/\rho$, where $\sigma_{0}$ is a constant. The inner conductor is charged to potential $

[Truncated for analysis]

## Core Ideas

- Ohm's law in point form is $\mathbf J=\sigma\mathbf E$.
- Resistance follows from the ratio of potential difference to total current.
- Layers traversed sequentially by current combine as differential series resistances.
- Side-by-side current channels under a common voltage combine in parallel.
- Spatial variation of $\sigma$ changes $\mathbf E$ even when current continuity fixes $\mathbf J$.
- Power consistency can be checked by integrating volumetric dissipation.

## Source Anchors

- Problem 5.8 asks for the resistance of a conducting truncated cone.
- Problem 5.11 treats radial current between coaxial cylindrical surfaces and verifies total dissipated power by volume integration.
- Problem 5.12 uses $\sigma(z)=\sigma_0e^{-z/d}$ between parallel plates.
- Problem 5.15 uses a hemispherical shell with $\sigma(r)=\sigma_0a/r$.
- Problem 5.16 uses a coaxial medium with $\sigma(\rho)=\sigma_0/\rho$ and asks for conductance per unit length.
- Problems 5.17 and 5.19 explicitly reconstruct resistance from differential shell combinations.

## Related Pages

- [[charge-continuity-and-current-flux-tasks|Charge Continuity and Current-Flux Tasks]]
- [[coaxial-and-spherical-capacitor-geometries|Coaxial and Spherical Capacitor Geometries]]
- [[series-and-parallel-multiple-dielectric-capacitors|Series and Parallel Multiple-Dielectric Capacitors]]

