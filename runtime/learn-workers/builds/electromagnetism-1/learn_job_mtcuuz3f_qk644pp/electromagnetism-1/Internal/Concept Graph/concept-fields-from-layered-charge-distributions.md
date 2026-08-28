---
title: "Fields from Layered Charge Distributions"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "fields-from-layered-charge-distributions"
locations: ["Page 72", "Page 84", "Page 85"]
related: ["spherical-gaussian-surface-for-a-point-charge", "infinite-uniform-line-charge-field", "coaxial-cable-field-and-electrostatic-shielding", "choosing-gaussian-surfaces-by-symmetry"]
---

## ConceptNode: Fields from Layered Charge Distributions

Planning node for [[fields-from-layered-charge-distributions|1.61 Fields from Layered Charge Distributions]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 72, Page 84, Page 85

Several exercises generalize Gauss's law to concentric spherical surfaces, cylindrical shells, and distributed volume charge. The reusable procedure is to divide space into radial regions, choose a gaussian surface consistent with the symmetry, calculate only the charge enclosed at that radius, and solve for the radial field. Crossing a charged shell changes the enclosed charge and therefore changes the field expression, while charges on shells outside the gaussian surface do not contribute to its enclosed-charge total. For spherical symmetry, $D_r4\pi r^2=Q_{\mathrm{enc}}(r)$. For cylindrical symmetry over length $L$, $D_\rho2\pi\rho L=Q_{\mathrm{enc}}(\rho)$. When charge is distributed through volume, the enclosed charge must first be integrated using the correct differential volume. Additional surface charge can be selected so that total enclosed charge vanishes beyond a specified radius, producing zero external field. This regional method underlies the exercises involving concentric charged spheres, charged cylindrical dielectrics, gaussian radial charge profiles, annular volume charge, and surfaces on which the electric field vanishes.

### Key planning details

- Partition the geometry at every radius where the charge law changes.
- Calculate $Q_{\mathrm{enc}}$ separately in each radial region.
- Use $D_r=Q_{\mathrm{enc}}/(4\pi r^2)$ for spherical symmetry.
- Use $D_\rho=Q_{\mathrm{enc}}/(2\pi\rho L)$ for cylindrical symmetry.
- Ignore charge outside the selected gaussian surface when forming $Q_{\mathrm{enc}}$.
- Include point, surface, and volume contributions inside the surface.
- Set total enclosed charge to zero when designing a zero external field.
- State the final field as a piecewise function.

### Source coverage

- Problem D3.5 on Page 72 combines a central point charge with surface charges on concentric spheres and asks for fields in multiple radial regions.
- Problem 3.9 on Page 84 asks for fields inside and outside a charged sphere and for a shell charge that makes the external field zero.
- Problems 3.10 and 3.11 on Page 84 use cylindrically symmetric volume charge distributions.
- Problem 3.13 on Page 85 uses three concentric charged spherical surfaces.
- Problem 3.15 on Page 85 uses charge confined to a cylindrical annulus.
- Problem 3.17 on Page 85 asks for surfaces on which $\mathbf{E}=0$ for a radial volume charge density.
