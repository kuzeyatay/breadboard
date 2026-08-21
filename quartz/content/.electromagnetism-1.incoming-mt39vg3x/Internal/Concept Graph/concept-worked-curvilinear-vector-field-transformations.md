---
title: "Worked Curvilinear Vector-Field Transformations"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "worked-curvilinear-vector-field-transformations"
locations: ["Page 30", "Example 1.3", "Page 33", "Example 1.4", "Page 34"]
related: ["vector-component-transformation-by-projection", "rectangular-and-cylindrical-point-transformations", "rectangular-and-spherical-point-transformations", "coordinate-system-applications-and-integration-tasks", "spherical-and-rectangular-basis-transformation-table"]
---

## ConceptNode: Worked Curvilinear Vector-Field Transformations

Planning node for [[worked-curvilinear-vector-field-transformations|1.24 Worked Curvilinear Vector-Field Transformations]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 30, Example 1.3, Page 33, Example 1.4, Page 34

The worked examples demonstrate the full two-stage vector transformation procedure. In Example 1.3, the rectangular field $\mathbf{B}=y\mathbf{a}_x-x\mathbf{a}_y+z\mathbf{a}_z$ is projected onto the cylindrical basis. Substituting $x=\rho\cos\phi$ and $y=\rho\sin\phi$ causes the radial component to cancel, while the azimuthal component becomes $-\rho$. The transformed field is therefore $\mathbf{B}=-\rho\mathbf{a}_\phi+z\mathbf{a}_z$. Example 1.4 transforms $\mathbf{G}=(xz/y)\mathbf{a}_x$ into spherical coordinates. Each spherical component is found by a dot product with $\mathbf{a}_r$, $\mathbf{a}_\theta$, or $\mathbf{a}_\phi$, followed by substitution of the spherical point relations. These examples show that a field's apparent complexity can change substantially when its basis is aligned with its geometry.

### Key planning details

- Project first or substitute variables first, but complete both operations.
- A zero transformed component can emerge through exact trigonometric cancellation.
- Example 1.3 produces $B_\rho=0$ and $B_\phi=-\rho$.
- The cylindrical result is $\mathbf{B}=-\rho\mathbf{a}_\phi+z\mathbf{a}_z$.
- Example 1.4 begins with a field having only a rectangular $x$ component.
- A single rectangular component generally contributes to all three spherical components.
- Factorization can reveal shared geometric dependence after transformation.

### Source coverage

- Example 1.3 evaluates $B_\rho=y\cos\phi-x\sin\phi=0$.
- Example 1.3 evaluates $B_\phi=-y\sin\phi-x\cos\phi=-\rho$.
- Example 1.4 obtains $G_r=r\sin\theta\cos\theta\cos^2\phi/\sin\phi$.
- Example 1.4 obtains $G_\theta=r\cos^2\theta\cos^2\phi/\sin\phi$.
- Example 1.4 obtains $G_\phi=-r\cos\theta\cos\phi$.
- The collected result is $\mathbf{G}=r\cos\theta\cos\phi(\sin\theta\cot\phi\,\mathbf{a}_r+\cos\theta\cot\phi\,\mathbf{a}_\theta-\mathbf{a}_\phi)$.
