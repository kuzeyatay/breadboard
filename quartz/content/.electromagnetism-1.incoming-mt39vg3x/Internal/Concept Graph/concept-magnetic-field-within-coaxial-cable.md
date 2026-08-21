---
title: "Magnetic Field Within a Coaxial Cable"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "magnetic-field-within-coaxial-cable"
locations: ["Page 204", "Page 205", "Page 206", "Section 7.2.3: Magnetic Field Within a Coaxial Cable", "Figure S1.P205.F1", "Figure S1.P206.F1"]
related: ["ampere-circuital-law-enclosed-current", "ampere-circuital-law-applied-filament", "current-source-representations", "magnetic-fields-solenoids-toroids"]
---

## ConceptNode: Magnetic Field Within a Coaxial Cable

Planning node for [[magnetic-field-within-coaxial-cable|1.109 Magnetic Field Within a Coaxial Cable]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 204, Page 205, Page 206, Section 7.2.3: Magnetic Field Within a Coaxial Cable, Figure S1.P205.F1, Figure S1.P206.F1

An infinitely long coaxial cable carries uniformly distributed current $I$ in its inner conductor of radius $a$ and return current $-I$ in its outer conductor between radii $b$ and $c$. Cylindrical symmetry and cancellation of radial components leave only $H_\phi(\rho)$. Ampere's law then produces a piecewise field. Inside the inner conductor, the enclosed fraction is $I\rho^2/a^2$, giving

$$H_\phi=\frac{I\rho}{2\pi a^2},\qquad \rho<a.$$

Between conductors,

$$H_\phi=\frac{I}{2\pi\rho},\qquad a<\rho<b.$$

Within the outer conductor, the enclosed return current grows with annular area, giving

$$H_\phi=\frac{I}{2\pi\rho}\frac{c^2-\rho^2}{c^2-b^2},\qquad b<\rho<c.$$

Outside the cable, equal positive and negative currents are enclosed, so $H_\phi=0$ for $\rho>c$. The field remains continuous at conductor boundaries because infinitesimal path changes enclose only infinitesimal current changes.

### Key planning details

- Coaxial symmetry leaves only an azimuthal field component.
- Uniform inner-conductor current makes enclosed current proportional to $\rho^2$.
- The field increases linearly with $\rho$ inside the center conductor.
- The field decreases as $1/\rho$ in the dielectric region.
- The field decreases to zero through the outer conductor.
- The external field is zero because the total enclosed current is $I-I=0$.
- The field is continuous at $\rho=a$, $\rho=b$, and $\rho=c$.

### Source coverage

- Figure S1.P205.F1 shows the coaxial cross section and cancellation of radial components from symmetric filaments.
- Page 204 gives $H_\phi=I/(2\pi\rho)$ for $a<\rho<b$.
- Page 205 gives $I_{\mathrm{encl}}=I\rho^2/a^2$ for $\rho<a$.
- Page 205 gives the outer-conductor expression $H_\phi=I(c^2-\rho^2)/[2\pi\rho(c^2-b^2)]$.
- Page 205 gives $H_\phi=0$ for $\rho>c$.
- Figure S1.P206.F1 plots field intensity against radius for $b=3a$ and $c=4a$.
- Page 206 identifies the zero external field as shielding caused by cancellation of equal opposite currents.
