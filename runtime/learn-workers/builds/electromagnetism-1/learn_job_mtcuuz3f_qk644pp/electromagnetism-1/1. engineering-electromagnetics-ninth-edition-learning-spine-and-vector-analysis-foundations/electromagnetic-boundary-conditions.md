---
title: "1.149 Electromagnetic Boundary Conditions"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 305"]
related: ["perfect-conductor-boundary-conditions", "boundary-condition-calculation-procedures", "maxwell-equation-application-problems"]
---

# 1.149 Electromagnetic Boundary Conditions

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 305

Maxwell's equations impose matching conditions on electric and magnetic fields at the interface between two media. The tangential magnetic field is continuous when no surface current is present, as expressed by $H_{t1}=H_{t2}$. The normal electric flux density can be discontinuous because free surface charge may reside at the interface, giving $D_{N1}-D_{N2}=\rho_S$. In contrast, the normal magnetic flux density is continuous, $B_{N1}=B_{N2}$, because magnetic monopole charge is absent. These boundary conditions are essential rather than optional additions to Maxwell's equations. Real electromagnetic systems normally contain multiple regions, so the field solution found separately in each region must satisfy the appropriate interface conditions. Even when Maxwell's equations are easy to solve within each homogeneous region, matching the solutions at a boundary can be the most difficult part of the problem.

## Page-Grounded Details

#### Page 305

and from (34),
$$
H_{t1}=H_{t2}\quad{(38)}
$$
The surface integrals produce the boundary conditions on the normal components,
$$
D_{N1}-D_{N2}=\rho_{S}\quad{(39)}
$$
and
$$
B_{N1}=B_{N2}\quad{(40)}
$$
It is often desirable to idealize a physical problem by assuming a perfect conductor for which $\sigma$ is infinite but J is finite. From Ohm's law, then, in a perfect conductor,
$$
E=0
$$
and it follows from the point form of Faraday's law that
$$
H=0
$$
for time-varying fields. The point form of Ampère's circuital law then shows that the finite value of J is
$$
J=0
$$
and current must be carried on the conductor surface as a surface current $\mathbf{K}$. Thus, if region 2 is a perfect conductor, (37) to (40) become, respectively,
$$
E_{t1}=0\quad{(41)}
$$
$$
H_{t1}=K\quad(\mathbf{H}_{t1}=\mathbf{K}\times\mathbf{a}_{N})\quad{(42)}
$$
$$
D_{N1}=\rho_{s}\quad{(43)}
$$
$$
B_{N1}=0\quad{(44)}
$$
where $\mathbf{a}_{N}$ is an outward normal at the conductor surface.

Note that surface charge density is considered a physical possibility for either dielectrics, perfect conductors, or imperfect conductors, but that surface current density is assumed only in conjunction

[Truncated for analysis]

## Core Ideas

- Tangential magnetic fields satisfy $H_{t1}=H_{t2}$ when no surface current is present.
- Normal electric flux densities satisfy $D_{N1}-D_{N2}=\rho_S$.
- Normal magnetic flux density is continuous: $B_{N1}=B_{N2}$.
- Boundary conditions connect field solutions obtained in adjacent regions.
- An unbounded homogeneous region is the exceptional case that requires no boundary matching.

## Source Anchors

- Equation (38) on Page 305 gives $H_{t1}=H_{t2}$.
- Equation (39) on Page 305 gives $D_{N1}-D_{N2}=\rho_S$.
- Equation (40) on Page 305 gives $B_{N1}=B_{N2}$.
- Page 305 states that all real physical problems have boundaries and generally require solutions in two or more regions.

## Related Pages

- [[perfect-conductor-boundary-conditions|Perfect-Conductor Boundary Conditions]]
- [[boundary-condition-calculation-procedures|Boundary-Condition Calculation Procedures]]
- [[maxwell-equation-application-problems|Maxwell-Equation Application Problems]]

