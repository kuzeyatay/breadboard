---
title: "Ampere's Circuital Law Applied to a Filament"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "ampere-circuital-law-applied-filament"
locations: ["Page 204", "Section 7.2.2: Application of Ampere's Law to a Filament Current"]
related: ["magnetic-field-infinite-straight-current-filament", "ampere-circuital-law-enclosed-current", "magnetic-field-within-coaxial-cable"]
---

## ConceptNode: Ampere's Circuital Law Applied to a Filament

Planning node for [[ampere-circuital-law-applied-filament|1.108 Ampere's Circuital Law Applied to a Filament]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 204, Section 7.2.2: Application of Ampere's Law to a Filament Current

Ampere's circuital law reproduces the infinite-filament field with much less calculation than direct Biot-Savart integration. For an infinite current on the $z$ axis, symmetry first shows that the field has no dependence on $z$ or $\phi$. The Biot-Savart direction rule then establishes that only the azimuthal component $H_\phi$ is present and that it depends only on $\rho$. An effective Amperian path must make the field either tangent or perpendicular to each path segment and should keep the field magnitude constant wherever the tangential contribution is nonzero. A circle of radius $\rho$ centered on the filament satisfies these conditions. Therefore,

$$\oint\mathbf{H}\cdot d\mathbf{L}=\int_0^{2\pi}H_\phi\rho\,d\phi=2\pi\rho H_\phi=I,$$

which gives $H_\phi=I/(2\pi\rho)$. The method illustrates the general workflow: inspect symmetry, determine surviving components, choose a compatible path, calculate enclosed current, and solve the reduced scalar equation.

### Key planning details

- Symmetry analysis must precede selection of an Amperian path.
- Biot-Savart reasoning identifies the field direction when symmetry alone is insufficient.
- The field is tangent to a circular path centered on the filament.
- The field magnitude is constant around that circular path.
- The path length contributing to circulation is $2\pi\rho$.
- Ampere's law gives $H_\phi=I/(2\pi\rho)$ without a source integration.

### Source coverage

- Page 204 states that the infinite-filament field has no $z$ or $\phi$ variation.
- Page 204 uses the Biot-Savart direction rule to identify $\mathbf{a}_\phi$ as the only field direction.
- Page 204 explains the path requirements of tangency or perpendicularity and constant field magnitude.
- Page 204 evaluates $\int_0^{2\pi}H_\phi\rho\,d\phi$.
- Page 204 obtains $H_\phi=I/(2\pi\rho)$.
