---
title: "Perfect-Conductor Boundary Conditions"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "perfect-conductor-boundary-conditions"
locations: ["Page 305"]
related: ["electromagnetic-boundary-conditions", "boundary-condition-calculation-procedures", "transmission-line-field-and-circuit-models"]
---

## ConceptNode: Perfect-Conductor Boundary Conditions

Planning node for [[perfect-conductor-boundary-conditions|1.150 Perfect-Conductor Boundary Conditions]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 305

A perfect conductor is an idealization in which conductivity $\sigma$ is infinite while physically meaningful currents remain finite. Ohm's law then requires the electric field inside the conductor to vanish, $\mathbf{E}=0$. For time-varying fields, Faraday's law and Ampère's law lead to zero interior time-varying electromagnetic fields and zero volume current density. Current is instead represented by a surface current density $\mathbf{K}$. At the outer surface, the tangential electric field is zero, the tangential magnetic field is determined by the surface current, the normal electric flux density equals the surface charge density, and the normal magnetic flux density is zero. With $\mathbf{a}_N$ directed outward from the conductor, the vector magnetic condition is $\mathbf{H}_{t1}=\mathbf{K}\times\mathbf{a}_N$. Surface charge can occur on dielectric, perfect-conductor, or imperfect-conductor interfaces, while the source reserves ideal surface current density for perfect conductors.

### Key planning details

- Inside a perfect conductor, $\mathbf{E}=0$.
- Time-varying electromagnetic fields vanish inside the perfect conductor.
- Conductor current is carried as surface current density $\mathbf{K}$ rather than volume current density.
- At the surface, $E_{t1}=0$ and $\mathbf{H}_{t1}=\mathbf{K}\times\mathbf{a}_N$.
- The normal conditions are $D_{N1}=\rho_S$ and $B_{N1}=0$.

### Source coverage

- Equations (41) through (44) on Page 305 give $E_{t1}=0$, $H_{t1}=K$, $D_{N1}=\rho_S$, and $B_{N1}=0$.
- Equation (42) gives the vector form $\mathbf{H}_{t1}=\mathbf{K}\times\mathbf{a}_N$.
- Page 305 identifies $\mathbf{a}_N$ as an outward normal at the conductor surface.
- Page 305 distinguishes broadly possible surface charge from surface current associated with perfect conductors.
