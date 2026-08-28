---
title: "1.151 Boundary-Condition Calculation Procedures"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 306", "Section: Developmental Problems D9.5 and D9.6"]
related: ["electromagnetic-boundary-conditions", "perfect-conductor-boundary-conditions", "maxwell-equation-application-problems"]
---

# 1.151 Boundary-Condition Calculation Procedures

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 306, Section: Developmental Problems D9.5 and D9.6

The source exercises show how a field at an interface is decomposed into normal and tangential components before material boundary conditions are applied. Given a unit normal $\mathbf{a}_N$, the normal vector component is obtained from $\mathbf{B}_N=(\mathbf{B}\cdot\mathbf{a}_N)\mathbf{a}_N$, and the tangential component is $\mathbf{B}_t=\mathbf{B}-\mathbf{B}_N$. Continuity of $B_N$ then transfers the normal magnetic flux density across a dielectric interface, while the tangential magnetic field condition and the different permeabilities determine the remaining field in the second medium. At a perfect conducting plane, the normal electric flux density determines surface charge through $D_N=\rho_S$, while the tangential magnetic field determines surface current through $\mathbf{K}=\mathbf{a}_N\times\mathbf{H}$. Direction conventions must be handled carefully because reversing the chosen normal reverses vector cross-product signs.

## Page-Grounded Details

#### Page 306

D9.5. The unit vector $0.64\mathbf{a}_{x}+0.6\mathbf{a}_{y}-0.48\mathbf{a}_{z}$ is directed from region 2 ($\epsilon_{r}=2,\mu_{r}=3,\sigma_{2}=0$) toward region 1 ($\epsilon_{r1}=4,\mu_{r1}=2,\sigma_{1}=0$). If $\mathbf{B}_{1}=(\mathbf{a}_{x}-2\mathbf{a}_{y}+3\mathbf{a}_{z})\sin300t$ T at point P in region 1 adjacent to the boundary, find the amplitude at P of: (a) $\mathbf{B}_{N1}$ ; (b) $\mathbf{B}_{t1}$ ; (c) $\mathbf{B}_{N2}$ ; (d) $\mathbf{B}_{2}$.

Ans. (a) 2.00 T; (b) 3.16 T; (c) 2.00 T; (d) 5.15 T

D9.6. The surface $y=0$ is a perfectly conducting plane, whereas the region$y>0$ has $\epsilon_{r}=5,\mu_{r}=3$ , and $\sigma=0$ . Let $\mathbf{E}=20\cos(2\times 10^{8}t-2.58z)\mathbf{a}_{y}$ V/m for$y>0$ , and find at $t=6$ ns; (a) $\rho_{S}$ at P(2, 0, 0.3); (b) $\mathbf{H}$ at P; (c) $\mathbf{K}$ at P.

Ans. (a) 0.81 nC/m^2; (b) $-62.3\mathbf{a}_{x}$ mA/m; (c) $-62.3\mathbf{a}_{z}$ mA/m

#### 9.5 THE RETARDED POTENTIALS

The time-varying potentials, usually called retarded potentials for a reason that we will see shortly, find their greatest application in radiation problems (to be addressed in Chapter 14) in which the distribution of t

[Truncated for analysis]

## Core Ideas

- Project a vector onto the interface normal using a dot product.
- Subtract the normal component from the total field to obtain the tangential component.
- Use continuity of $B_N$ across ordinary material interfaces.
- Relate $D_N$ to $\rho_S$ at a perfect conductor.
- Relate tangential $\mathbf{H}$ to surface current $\mathbf{K}$ with the stated normal orientation.

## Source Anchors

- Developmental Problem D9.5 on Page 306 supplies a unit normal, material parameters, and a time-varying $\mathbf{B}_1$ to determine normal, tangential, and transmitted magnetic components.
- D9.5 reports amplitudes of 2.00 T for $\mathbf{B}_{N1}$, 3.16 T for $\mathbf{B}_{t1}$, 2.00 T for $\mathbf{B}_{N2}$, and 5.15 T for $\mathbf{B}_2$.
- Developmental Problem D9.6 on Page 306 applies perfect-conductor conditions at $y=0$.
- D9.6 reports $\rho_S=0.81$ nC/m$^2$, $\mathbf{H}=-62.3\mathbf{a}_x$ mA/m, and $\mathbf{K}=-62.3\mathbf{a}_z$ mA/m at the specified event.

## Related Pages

- [[electromagnetic-boundary-conditions|Electromagnetic Boundary Conditions]]
- [[perfect-conductor-boundary-conditions|Perfect-Conductor Boundary Conditions]]
- [[maxwell-equation-application-problems|Maxwell-Equation Application Problems]]

## Concept Dependencies

- applies-to: [[electromagnetic-boundary-conditions|Electromagnetic Boundary Conditions]]
- applies-to: [[perfect-conductor-boundary-conditions|Perfect-Conductor Boundary Conditions]]
