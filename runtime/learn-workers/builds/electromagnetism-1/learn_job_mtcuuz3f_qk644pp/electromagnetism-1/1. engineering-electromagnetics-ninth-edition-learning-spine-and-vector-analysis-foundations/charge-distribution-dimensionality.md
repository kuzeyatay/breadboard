---
title: "1.41 Charge-Distribution Dimensionality"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 45", "Page 48", "Page 51", "Section: 2.3", "Section: 2.4", "Section: 2.5"]
related: ["volume-charge-density-and-total-enclosed-charge", "symmetry-of-an-infinite-uniform-line-charge", "field-of-an-infinite-uniform-sheet"]
---

# 1.41 Charge-Distribution Dimensionality

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 45, Page 48, Page 51, Section: 2.3, Section: 2.4, Section: 2.5

The source organizes idealized charge distributions by the dimensional region over which charge is spread. A point charge $Q$ is concentrated at one position. A line charge is described by linear density $\rho_L$ in $\mathrm{C/m}$ and approximates a thin charged filament or conductor. A surface charge is described by $\rho_S$ in $\mathrm{C/m^2}$ and is especially relevant because static charge resides on conductor surfaces. A volume charge is described by $\rho_v$ in $\mathrm{C/m^3}$. Moving between these models changes both the differential source element and the distance dependence of highly symmetric fields. The chapter develops point, volume, line, and sheet configurations as a connected family rather than unrelated formulas. Choosing the correct dimensional model is therefore the first step in translating a physical charge arrangement into a field calculation.

## Page-Grounded Details

#### Page 45

D2.3. Evaluate the sums: (a) $\sum_{m=0}^{5}\frac{1+(-1)^{m}}{m^{2}+1}$; (b) $\sum_{m=1}^{4}\frac{(0.1)^{m}+1}{(4+m^{2})^{1.5}}$

Ans. (a) 2.52; (b) 0.176

#### 2.3 FIELD ARISING FROM A CONTINUOUS VOLUME CHARGE DISTRIBUTION

If we now visualize a region of space filled with a tremendous number of charges separated by minute distances, we see that we can replace this distribution of very small particles with a smooth continuous distribution described by a volume charge density, just as we describe water as having a density of 1 g/cm^3 (gram per cubic centimeter) even though it consists of atomic- and molecular-sized particles. This can be done only if we are uninterested in the small irregularities (or ripples) in the field as we move from electron to electron or if we care little that the mass of the water actually increases in small but finite steps as each new molecule is added.

This is really no limitation at all, because the end results for electrical engineers are almost always in terms of a current in a receiving antenna, a voltage in an electronic circuit, or a charge on a capacitor, or in general in terms of some large-scale macroscopic phenomenon. It is very seldom th

[Truncated for analysis]

#### Page 48

#### 2.4 FIELD OF A LINE CHARGE

Up to this point we have considered two types of charge distribution, the point charge and continuous charge distributed throughout a volume with a density $\rho_{v}$ C/m^3. We now con-sider a filamentlike distribution of volume charge density, such as a charged conductor of very small radius. It is convenient to treat the charge as a line charge of density $\rho_{L}$ C/m.

Consider a straight-line charge extending along the $z$ axis in a cylindrical coord-inate system from $-\infty$ to $\infty$, as shown in Figure 2.6. We will find the electric field intensity $\mathbf{E}$ at any and every point resulting from a _uniform_ line charge density $\rho_{L}$.

#### 2.4.1 Setting Up the Problem: The Importance of Symmetry

Symmetry should always be considered first in order to determine two specific fac-tors: (1) with which coordinates the field does _not_ vary, and (2) which components of the field are _not_ present. The answers to these questions then tell us which compo-nents are present and with which coordinates they _do_ vary.

Referring to Figure 2.6, we realize that as we move around the line charge, varying $\phi$ while keeping $

[Truncated for analysis]

#### Page 51

$\rho$ is replaced in (16) by the radial distance between the line charge and point, $P,R=\sqrt{(x-6)^{2}+(y-8)^{2}}$, and let $a_{\rho}$ be $a_{R}$. Thus,
$$
E=\frac{\rho_{L}}{2\pi\epsilon_{0}\sqrt{(x-6)^{2}+(y-8)^{2}}}a_{R}
$$
where
$$
a_{R}=\frac{R}{|R|}=\frac{(x-6)a_{x}+(y-8)a_{y}}{\sqrt{(x-6)^{2}+(y-8)^{2}}}
$$
Therefore,
$$
E=\frac{\rho_{L}}{2\pi\epsilon_{0}}\frac{(x-6)a_{x}+(y-8)a_{y}}{(x-6)^{2}+(y-8)^{2}}
$$
We again note that the field is not a function of $z$.

In Section 2.6, we describe how fields may be sketched, and the field of the line charge is one example.

D2.5. Infinite uniform line charges of 5 nC/m lie along the (positive and negative) x and y axes in free space. Find E at: (a) $P_{A}(0,0,4)$; (b) $P_{B}(0,3,4)$.

Ans. (a) $45a_{z}$ V/m; (b) $10.8a_{y}+36.9a_{z}$ V/m

#### 2.5 FIELD OF A SHEET OF CHARGE

Another basic charge configuration is the infinite sheet of charge having a uniform density of $\rho_{S}$ C/$m^{2}$. Such a charge distribution may often be used to approximate that found on the conductors of a strip transmission line or a parallel-plate capacitor. As will be seen in Chapter 5, static charge resides on conductor sur

[Truncated for analysis]

## Core Ideas

- Point charge uses total charge $Q$.
- Line charge uses $\rho_L$ with units $\mathrm{C/m}$.
- Surface charge uses $\rho_S$ with units $\mathrm{C/m^2}$.
- Volume charge uses $\rho_v$ with units $\mathrm{C/m^3}$.
- A filamentlike conductor can be approximated as a line charge.
- Static conductor charge motivates the surface-charge model.

## Source Anchors

- Section 2.4 introduces a filamentlike distribution with linear density $\rho_L$.
- Section 2.5 introduces an infinite sheet with uniform surface density $\rho_S$.
- The text states that the charge-distribution family is point, line, surface, and volume: $Q$, $\rho_L$, $\rho_S$, and $\rho_v$.
- The sheet model is connected to strip transmission lines and parallel-plate capacitors.
- The volume model is developed through $Q=\int_{\mathrm{vol}}\rho_vdv$.

## Related Pages

- [[volume-charge-density-and-total-enclosed-charge|Volume Charge Density and Total Enclosed Charge]]
- [[symmetry-of-an-infinite-uniform-line-charge|Symmetry of an Infinite Uniform Line Charge]]
- [[field-of-an-infinite-uniform-sheet|Field of an Infinite Uniform Sheet]]

## Concept Dependencies

- related: [[volume-charge-density-and-total-enclosed-charge|Volume Charge Density and Total Enclosed Charge]]
- related: [[symmetry-of-an-infinite-uniform-line-charge|Symmetry of an Infinite Uniform Line Charge]]
- related: [[field-of-an-infinite-uniform-sheet|Field of an Infinite Uniform Sheet]]
