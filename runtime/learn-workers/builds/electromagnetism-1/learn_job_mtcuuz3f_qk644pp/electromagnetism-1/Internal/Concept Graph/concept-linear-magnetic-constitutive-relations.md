---
title: "Linear Magnetic Constitutive Relations"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "linear-magnetic-constitutive-relations"
locations: ["Page 263", "Page 264", "Page 265", "Page 266", "Section 8.6", "Example 8.5", "Problem D8.6"]
related: ["magnetization-and-bound-currents", "anisotropic-and-nonlinear-magnetic-media", "magnetic-boundary-conditions", "magnetic-circuit-analogy-and-reluctance"]
---

## ConceptNode: Linear Magnetic Constitutive Relations

Planning node for [[linear-magnetic-constitutive-relations|1.121 Linear Magnetic Constitutive Relations]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 263, Page 264, Page 265, Page 266, Section 8.6, Example 8.5, Problem D8.6

The general relationship among magnetic flux density, magnetic field intensity, and magnetization is $\mathbf{B}=\mu_0(\mathbf{H}+\mathbf{M})$. In a linear isotropic material, magnetization is proportional to field intensity, $\mathbf{M}=\chi_m\mathbf{H}$, where $\chi_m$ is magnetic susceptibility. Substitution gives $\mathbf{B}=\mu_0(1+\chi_m)\mathbf{H}$. Relative permeability is therefore defined by $\mu_r=1+\chi_m$, and absolute permeability is $\mu=\mu_0\mu_r$. These definitions reduce the constitutive relationship to $\mathbf{B}=\mu\mathbf{H}$. Example 8.5 applies the chain of relations to a linear ferrite with $B=0.05$ T and $\mu_r=50$. It obtains $\chi_m=49$, $H=796$ A/m, and $M=39{,}000$ A/m. The example also shows two equivalent interpretations: one can explicitly add the free-current and magnetization contributions through $\mu_0(H+M)$, or absorb the bound-charge response into the relative permeability through $\mu_r\mu_0H$. The latter interpretation is adopted for subsequent engineering calculations.

### Key planning details

- The general material relation is $\mathbf{B}=\mu_0(\mathbf{H}+\mathbf{M})$.
- Linear isotropic media satisfy $\mathbf{M}=\chi_m\mathbf{H}$.
- Relative permeability is $\mu_r=1+\chi_m$.
- Absolute permeability is $\mu=\mu_0\mu_r$.
- The simplified constitutive law is $\mathbf{B}=\mu\mathbf{H}$.
- In free space, $\mathbf{M}=0$ and $\mathbf{B}=\mu_0\mathbf{H}$.
- Susceptibility is dimensionless, while $H$ and $M$ are measured in A/m.
- Material response may be represented explicitly through $M$ or implicitly through $\mu_r$.

### Source coverage

- Equation (25) gives $\mathbf{B}=\mu_0(\mathbf{H}+\mathbf{M})$.
- Equations (28) through (31) define $\mathbf{M}=\chi_m\mathbf{H}$, $\mu_r=1+\chi_m$, $\mu=\mu_0\mu_r$, and $\mathbf{B}=\mu\mathbf{H}$.
- Example 8.5 uses $B=0.05$ T and $\mu_r=50$ to calculate $\chi_m=49$, $H=796$ A/m, and $M=39{,}000$ A/m.
- The example states that the Amperian-current contribution is 49 times the free-charge field-intensity contribution.
- Problem D8.6 asks for magnetization from combinations of $\mu$, $\mu_r$, atomic dipole density, $B$, and $\chi_m$.
