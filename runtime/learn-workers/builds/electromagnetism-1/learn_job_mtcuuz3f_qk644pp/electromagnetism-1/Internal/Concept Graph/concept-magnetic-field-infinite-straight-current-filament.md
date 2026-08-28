---
title: "Magnetic Field of an Infinite Straight Current Filament"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "magnetic-field-infinite-straight-current-filament"
locations: ["Page 198", "Page 199", "Page 200", "Section 7.1.3: Magnetic Field of a Current Filament", "Figure S1.P198.F1", "Figure S1.P199.F1"]
related: ["differential-biot-savart-law", "finite-straight-current-filaments-superposition", "ampere-circuital-law-applied-filament", "physical-meaning-of-curl"]
---

## ConceptNode: Magnetic Field of an Infinite Straight Current Filament

Planning node for [[magnetic-field-infinite-straight-current-filament|1.105 Magnetic Field of an Infinite Straight Current Filament]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 198, Page 199, Page 200, Section 7.1.3: Magnetic Field of a Current Filament, Figure S1.P198.F1, Figure S1.P199.F1

For an infinitely long current filament on the $z$ axis carrying current $I$ in the $+z$ direction, symmetry eliminates dependence on $z$ and $\phi$. At a field point $\mathbf{r}=\rho\mathbf{a}_\rho$ in the $z=0$ plane, a source point is $\mathbf{r}'=z'\mathbf{a}_z$, so

$$\mathbf{R}_{12}=\rho\mathbf{a}_\rho-z'\mathbf{a}_z.$$

With $d\mathbf{L}=dz'\mathbf{a}_z$, the cross product leaves only an $\mathbf{a}_\phi$ component. Integration from $z'=-\infty$ to $z'=\infty$ gives

$$\mathbf{H}=\frac{I}{2\pi\rho}\mathbf{a}_\phi.$$

The cylindrical unit vector $\mathbf{a}_\phi$ may be moved outside this particular integral because it varies with $\phi$, while the integration variable is $z'$. The field is circumferential, independent of $z$ and $\phi$, and inversely proportional to radial distance $\rho$. Its streamlines are concentric circles centered on the filament, with direction determined by the right-hand rule.

### Key planning details

- Cylindrical symmetry makes $\mathbf{H}$ independent of $z$ and $\phi$.
- The cross product selects the azimuthal direction $\mathbf{a}_\phi$.
- The source coordinate is integrated from $-\infty$ to $\infty$.
- The result is $\mathbf{H}=I\mathbf{a}_\phi/(2\pi\rho)$.
- The field magnitude decreases as $1/\rho$.
- The field streamlines are circles around the current filament.
- A curvilinear unit vector may leave an integral only if it is constant with respect to the integration variable.

### Source coverage

- Figure S1.P198.F1 defines the infinite-filament geometry and states $\mathbf{H}=(I/2\pi\rho)\mathbf{a}_\phi$.
- Page 198 constructs $\mathbf{R}_{12}=\rho\mathbf{a}_\rho-z'\mathbf{a}_z$.
- Pages 198-199 show the Biot-Savart integration over $z'$.
- Page 199 explains why $\mathbf{a}_\phi$ is constant during integration with respect to $z'$.
- Page 199 gives the final result $\mathbf{H}=I\mathbf{a}_\phi/(2\pi\rho)$.
- Figure S1.P199.F1 maps the circular magnetic-field streamlines for current directed into the page.
- Page 200 compares the circular magnetic streamlines with the equipotentials of an infinite electric line charge.
