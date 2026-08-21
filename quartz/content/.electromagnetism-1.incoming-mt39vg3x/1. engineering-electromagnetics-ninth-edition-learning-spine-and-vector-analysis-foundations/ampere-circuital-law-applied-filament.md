---
title: "1.108 Ampere's Circuital Law Applied to a Filament"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 204", "Section 7.2.2: Application of Ampere's Law to a Filament Current"]
related: ["magnetic-field-infinite-straight-current-filament", "ampere-circuital-law-enclosed-current", "magnetic-field-within-coaxial-cable"]
---

# 1.108 Ampere's Circuital Law Applied to a Filament

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 204, Section 7.2.2: Application of Ampere's Law to a Filament Current

Ampere's circuital law reproduces the infinite-filament field with much less calculation than direct Biot-Savart integration. For an infinite current on the $z$ axis, symmetry first shows that the field has no dependence on $z$ or $\phi$. The Biot-Savart direction rule then establishes that only the azimuthal component $H_\phi$ is present and that it depends only on $\rho$. An effective Amperian path must make the field either tangent or perpendicular to each path segment and should keep the field magnitude constant wherever the tangential contribution is nonzero. A circle of radius $\rho$ centered on the filament satisfies these conditions. Therefore,
$$
\oint\mathbf{H}\cdot d\mathbf{L}=\int_0^{2\pi}H_\phi\rho\,d\phi=2\pi\rho H_\phi=I
$$
which gives $H_\phi=I/(2\pi\rho)$. The method illustrates the general workflow: inspect symmetry, determine surviving components, choose a compatible path, calculate enclosed current, and solve the reduced scalar equation.

## Page-Grounded Details

#### Page 204

#### 7.2.2 Application of Ampere's Law to a Filament Current

Here we again find the magnetic field intensity produced by an infinitely long filament carrying a current $I$. The filament lies on the $z$ axis in free space (as in Figure 7.3), and the current flows in the direction given by $\mathbf{a}_{z}$. Symmetry inspection comes first, showing that there is no variation with $z$ or $\phi$. Next we determine which components of $\mathbf{H}$ are present by using the Biot-Savart law. Without specifically using the cross product, we may say that the direction of $d\mathbf{H}$ is perpendicular to the plane containing $d\mathbf{L}$ and $\mathbf{R}$ and therefore is in the direction of $\mathbf{a}_{\phi}$. Hence the only component of $\mathbf{H}$ is $H_{\phi}$, and it is a function only of $\rho$.

We therefore choose a path, to any section of which $\mathbf{H}$ is either perpendicular or tangential, and along which $H$ is constant. The first requirement (perpendicularity or tangency) allows us to replace the dot product of Ampère's circuital law with the product of the scalar magnitudes, except along that portion of the path where $\mathbf{H}$ is normal

[Truncated for analysis]

## Core Ideas

- Symmetry analysis must precede selection of an Amperian path.
- Biot-Savart reasoning identifies the field direction when symmetry alone is insufficient.
- The field is tangent to a circular path centered on the filament.
- The field magnitude is constant around that circular path.
- The path length contributing to circulation is $2\pi\rho$.
- Ampere's law gives $H_\phi=I/(2\pi\rho)$ without a source integration.

## Source Anchors

- Page 204 states that the infinite-filament field has no $z$ or $\phi$ variation.
- Page 204 uses the Biot-Savart direction rule to identify $\mathbf{a}_\phi$ as the only field direction.
- Page 204 explains the path requirements of tangency or perpendicularity and constant field magnitude.
- Page 204 evaluates $\int_0^{2\pi}H_\phi\rho\,d\phi$.
- Page 204 obtains $H_\phi=I/(2\pi\rho)$.

## Related Pages

- [[magnetic-field-infinite-straight-current-filament|Magnetic Field of an Infinite Straight Current Filament]]
- [[ampere-circuital-law-enclosed-current|Ampere's Circuital Law and Enclosed Current]]
- [[magnetic-field-within-coaxial-cable|Magnetic Field Within a Coaxial Cable]]

## Concept Dependencies

- applies-to: [[ampere-circuital-law-enclosed-current|Ampere's Circuital Law and Enclosed Current]]
- derives-from: [[magnetic-field-infinite-straight-current-filament|Magnetic Field of an Infinite Straight Current Filament]]
