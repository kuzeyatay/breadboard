---
title: "Magnetic Fields of Solenoids and Toroids"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "magnetic-fields-solenoids-toroids"
locations: ["Page 207", "Page 208", "Page 209", "Section 7.2.5: Magnetic Fields Within Solenoids and Toroids", "Figure S1.P208.F1", "Figure S1.P209.F1", "Exercise D7.3"]
related: ["ampere-circuital-law-enclosed-current", "magnetic-field-infinite-current-sheet", "magnetic-field-within-coaxial-cable"]
---

## ConceptNode: Magnetic Fields of Solenoids and Toroids

Planning node for [[magnetic-fields-solenoids-toroids|1.111 Magnetic Fields of Solenoids and Toroids]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 207, Page 208, Page 209, Section 7.2.5: Magnetic Fields Within Solenoids and Toroids, Figure S1.P208.F1, Figure S1.P209.F1, Exercise D7.3

Ampere's circuital law gives compact ideal or approximate fields for solenoids and toroids. An infinitely long solenoid of radius $a$ with surface current $\mathbf{K}=K_a\mathbf{a}_\phi$ has

$$\mathbf{H}=K_a\mathbf{a}_z\quad(\rho<a),\qquad \mathbf{H}=0\quad(\rho>a).$$

For a finite, closely wound $N$-turn solenoid of length $d$ carrying current $I$, points well inside have

$$\mathbf{H}\approx\frac{NI}{d}\mathbf{a}_z.$$

The approximation should not be used close to the open ends or close to the winding surface. For an ideal toroid, the field is azimuthal inside and zero outside. For an $N$-turn filamentary toroid,

$$\mathbf{H}\approx\frac{NI}{2\pi\rho}\mathbf{a}_\phi$$

inside, with approximately zero field outside. The toroidal approximation applies away from the winding surface by several turn spacings. These examples show how winding geometry confines or concentrates a magnetic field.

### Key planning details

- An ideal infinite solenoid has a uniform axial field inside and zero field outside.
- The finite-solenoid approximation is $\mathbf{H}\approx(NI/d)\mathbf{a}_z$ well inside.
- Finite-solenoid end and turn-spacing effects limit the approximation.
- A toroid produces an azimuthal field inside its core region.
- The $N$-turn toroid approximation is $\mathbf{H}\approx NI\mathbf{a}_\phi/(2\pi\rho)$.
- Ideal and sufficiently dense toroidal windings have approximately zero external field.

### Source coverage

- Page 207 gives the ideal-solenoid results $\mathbf{H}=K_a\mathbf{a}_z$ inside and zero outside.
- Figure S1.P208.F1 compares an ideal infinite solenoid with a finite $N$-turn solenoid.
- Page 208 gives $\mathbf{H}=NI\mathbf{a}_z/d$ well within a finite solenoid.
- Page 208 limits that approximation near open ends and near the winding surface.
- Page 208 gives the ideal-toroid field and zero external field.
- Page 208 gives $\mathbf{H}=NI\mathbf{a}_\phi/(2\pi\rho)$ for an $N$-turn toroid.
- Figure S1.P209.F1 compares ideal surface-current and $N$-turn toroids.
- Page 209 exercise D7.3 tests fields from a filament, coaxial cable, and multiple current sheets.
