---
title: "Boundary-Condition Calculation Procedures"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "boundary-condition-calculation-procedures"
locations: ["Page 306", "Section: Developmental Problems D9.5 and D9.6"]
related: ["electromagnetic-boundary-conditions", "perfect-conductor-boundary-conditions", "maxwell-equation-application-problems"]
---

## ConceptNode: Boundary-Condition Calculation Procedures

Planning node for [[boundary-condition-calculation-procedures|1.151 Boundary-Condition Calculation Procedures]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 306, Section: Developmental Problems D9.5 and D9.6

The source exercises show how a field at an interface is decomposed into normal and tangential components before material boundary conditions are applied. Given a unit normal $\mathbf{a}_N$, the normal vector component is obtained from $\mathbf{B}_N=(\mathbf{B}\cdot\mathbf{a}_N)\mathbf{a}_N$, and the tangential component is $\mathbf{B}_t=\mathbf{B}-\mathbf{B}_N$. Continuity of $B_N$ then transfers the normal magnetic flux density across a dielectric interface, while the tangential magnetic field condition and the different permeabilities determine the remaining field in the second medium. At a perfect conducting plane, the normal electric flux density determines surface charge through $D_N=\rho_S$, while the tangential magnetic field determines surface current through $\mathbf{K}=\mathbf{a}_N\times\mathbf{H}$. Direction conventions must be handled carefully because reversing the chosen normal reverses vector cross-product signs.

### Key planning details

- Project a vector onto the interface normal using a dot product.
- Subtract the normal component from the total field to obtain the tangential component.
- Use continuity of $B_N$ across ordinary material interfaces.
- Relate $D_N$ to $\rho_S$ at a perfect conductor.
- Relate tangential $\mathbf{H}$ to surface current $\mathbf{K}$ with the stated normal orientation.

### Source coverage

- Developmental Problem D9.5 on Page 306 supplies a unit normal, material parameters, and a time-varying $\mathbf{B}_1$ to determine normal, tangential, and transmitted magnetic components.
- D9.5 reports amplitudes of 2.00 T for $\mathbf{B}_{N1}$, 3.16 T for $\mathbf{B}_{t1}$, 2.00 T for $\mathbf{B}_{N2}$, and 5.15 T for $\mathbf{B}_2$.
- Developmental Problem D9.6 on Page 306 applies perfect-conductor conditions at $y=0$.
- D9.6 reports $\rho_S=0.81$ nC/m$^2$, $\mathbf{H}=-62.3\mathbf{a}_x$ mA/m, and $\mathbf{K}=-62.3\mathbf{a}_z$ mA/m at the specified event.
