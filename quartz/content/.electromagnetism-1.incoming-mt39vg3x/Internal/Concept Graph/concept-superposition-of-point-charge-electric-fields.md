---
title: "Superposition of Point-Charge Electric Fields"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "superposition-of-point-charge-electric-fields"
locations: ["Page 44", "Page 45", "Section: Example 2.2"]
related: ["electric-field-integral-for-a-volume-charge-distribution", "multipoles-finite-charge-distributions-and-far-field-limits", "electric-flux-density-from-charge"]
---

## ConceptNode: Superposition of Point-Charge Electric Fields

Planning node for [[superposition-of-point-charge-electric-fields|1.37 Superposition of Point-Charge Electric Fields]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 44, Page 45, Section: Example 2.2

The electric field produced by several point charges is the vector sum of the individual Coulomb fields. For a field point at position $\mathbf{r}$ and a charge $Q_m$ at source position $\mathbf{r}_m$, the displacement from source to field point is $\mathbf{r}-\mathbf{r}_m$. Its magnitude determines the inverse-square factor, while its normalized form supplies the field direction. Thus each contribution must be resolved as a vector before the contributions are added. Example 2.2 applies this process to four identical charges in the $z=0$ plane and a field point at $P(1,1,1)$. The unequal source-to-field distances prevent complete cancellation, even though the source geometry is symmetric. The example demonstrates the reusable procedure of constructing position vectors, computing displacements and distances, forming unit vectors, multiplying by Coulomb magnitudes, and finally summing Cartesian components.

### Key planning details

- For $n$ charges, the total field is the vector sum of all individual fields.
- The source-to-field displacement for charge $m$ is $\mathbf{r}-\mathbf{r}_m$.
- Each contribution has inverse-square magnitude and points along the corresponding displacement unit vector.
- Vector components must be summed after each contribution is expressed in a common coordinate basis.
- Geometric symmetry can simplify a sum, but cancellation must be checked component by component.

### Source coverage

- Equation (11): $$\mathbf{E}(\mathbf{r})=\sum_{m=1}^{n}\frac{Q_m}{4\pi\epsilon_0|\mathbf{r}-\mathbf{r}_m|^2}\mathbf{a}_m.$$
- Example 2.2 places four identical $3\,\mathrm{nC}$ charges at $(1,1,0)$, $(-1,1,0)$, $(-1,-1,0)$, and $(1,-1,0)$.
- For $P(1,1,1)$, the four source distances are $1$, $\sqrt{5}$, $3$, and $\sqrt{5}$.
- The example obtains $\mathbf{E}=6.82\mathbf{a}_x+6.82\mathbf{a}_y+32.8\mathbf{a}_z\,\mathrm{V/m}$.
- Source figure S1.P44.F1, Figure 2.4, depicts the four-charge geometry and the resulting field at $P$.
- Drill D2.2 applies the same procedure to two charges specified in centimeters and reports fields in $\mathrm{kV/m}$.
