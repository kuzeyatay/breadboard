---
title: "Vector Form of Coulomb's Law"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "vector-form-of-coulombs-law"
locations: ["Page 39", "Page 40", "Figure 2.1", "Equations (3) and (4)", "Example 2.1"]
related: ["coulombs-experimental-inverse-square-law", "mutual-force-linearity-and-superposition", "point-charge-electric-field-at-the-origin-and-general-locations", "geometric-procedures-using-dot-and-cross-products"]
---

## ConceptNode: Vector Form of Coulomb's Law

Planning node for [[vector-form-of-coulombs-law|1.32 Vector Form of Coulomb's Law]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 39, Page 40, Figure 2.1, Equations (3) and (4), Example 2.1

The vector form of Coulomb's law combines the force magnitude with a directed displacement between source and observation charges. If $\mathbf{r}_1$ locates $Q_1$ and $\mathbf{r}_2$ locates $Q_2$, then $\mathbf{R}_{12}=\mathbf{r}_2-\mathbf{r}_1$ points from $Q_1$ to $Q_2$, and $$\mathbf{a}_{12}=\frac{\mathbf{R}_{12}}{|\mathbf{R}_{12}|}.$$ The force on $Q_2$ is $$\mathbf{F}_2=\frac{Q_1Q_2}{4\pi\epsilon_0R_{12}^2}\mathbf{a}_{12}.$$ The charge product supplies the sign, so a negative product reverses the force relative to $\mathbf{a}_{12}$. Figure 2.1 shows the like-charge case, where the force on $Q_2$ points in the same direction as $\mathbf{R}_{12}$. The procedure is reusable: construct the directed displacement, compute its magnitude, normalize it, evaluate the scalar coefficient, and combine coefficient and direction.

### Key planning details

- Define $\mathbf{R}_{12}=\mathbf{r}_2-\mathbf{r}_1$.
- Define $\mathbf{a}_{12}=\mathbf{R}_{12}/R_{12}$.
- Use $\mathbf{F}_2=[Q_1Q_2/(4\pi\epsilon_0R_{12}^2)]\mathbf{a}_{12}$.
- The displacement must point from the source charge to the charge experiencing the force.
- A negative charge product reverses the unit-vector direction.
- The final vector can be reported as magnitude times unit direction or in rectangular components.

### Source coverage

- Equation (3) gives the vector form of Coulomb's law.
- Equation (4) defines $\mathbf{a}_{12}$ from $\mathbf{r}_2-\mathbf{r}_1$.
- Figure 2.1 depicts the displacement and force directions for like charges.
- Example 2.1 constructs $\mathbf{R}_{12}=\mathbf{a}_x-2\mathbf{a}_y+2\mathbf{a}_z$.
- Example 2.1 finds $R_{12}=3$ and $\mathbf{a}_{12}=(\mathbf{a}_x-2\mathbf{a}_y+2\mathbf{a}_z)/3$.
- The resulting force is $\mathbf{F}_2=-10\mathbf{a}_x+20\mathbf{a}_y-20\mathbf{a}_z\ \mathrm{N}$ with magnitude $30\ \mathrm{N}$.
