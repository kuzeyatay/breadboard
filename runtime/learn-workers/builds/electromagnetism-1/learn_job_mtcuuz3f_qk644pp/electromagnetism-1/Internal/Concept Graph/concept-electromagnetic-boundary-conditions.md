---
title: "Electromagnetic Boundary Conditions"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "electromagnetic-boundary-conditions"
locations: ["Page 305"]
related: ["perfect-conductor-boundary-conditions", "boundary-condition-calculation-procedures", "maxwell-equation-application-problems"]
---

## ConceptNode: Electromagnetic Boundary Conditions

Planning node for [[electromagnetic-boundary-conditions|1.149 Electromagnetic Boundary Conditions]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 305

Maxwell's equations impose matching conditions on electric and magnetic fields at the interface between two media. The tangential magnetic field is continuous when no surface current is present, as expressed by $H_{t1}=H_{t2}$. The normal electric flux density can be discontinuous because free surface charge may reside at the interface, giving $D_{N1}-D_{N2}=\rho_S$. In contrast, the normal magnetic flux density is continuous, $B_{N1}=B_{N2}$, because magnetic monopole charge is absent. These boundary conditions are essential rather than optional additions to Maxwell's equations. Real electromagnetic systems normally contain multiple regions, so the field solution found separately in each region must satisfy the appropriate interface conditions. Even when Maxwell's equations are easy to solve within each homogeneous region, matching the solutions at a boundary can be the most difficult part of the problem.

### Key planning details

- Tangential magnetic fields satisfy $H_{t1}=H_{t2}$ when no surface current is present.
- Normal electric flux densities satisfy $D_{N1}-D_{N2}=\rho_S$.
- Normal magnetic flux density is continuous: $B_{N1}=B_{N2}$.
- Boundary conditions connect field solutions obtained in adjacent regions.
- An unbounded homogeneous region is the exceptional case that requires no boundary matching.

### Source coverage

- Equation (38) on Page 305 gives $H_{t1}=H_{t2}$.
- Equation (39) on Page 305 gives $D_{N1}-D_{N2}=\rho_S$.
- Equation (40) on Page 305 gives $B_{N1}=B_{N2}$.
- Page 305 states that all real physical problems have boundaries and generally require solutions in two or more regions.
