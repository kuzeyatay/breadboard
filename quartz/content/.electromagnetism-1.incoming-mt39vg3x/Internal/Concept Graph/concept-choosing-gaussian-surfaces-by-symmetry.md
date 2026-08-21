---
title: "Choosing Gaussian Surfaces by Symmetry"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "choosing-gaussian-surfaces-by-symmetry"
locations: ["Page 68", "Page 69", "Page 70", "Page 71", "Page 72"]
related: ["spherical-gaussian-surface-for-a-point-charge", "infinite-uniform-line-charge-field", "coaxial-cable-field-and-electrostatic-shielding", "fields-from-layered-charge-distributions"]
---

## ConceptNode: Choosing Gaussian Surfaces by Symmetry

Planning node for [[choosing-gaussian-surfaces-by-symmetry|1.57 Choosing Gaussian Surfaces by Symmetry]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 68, Page 69, Page 70, Page 71, Page 72

Gauss's law becomes a direct field-solving method only when symmetry allows the flux integral to simplify. The source gives two practical requirements. First, the field must be either normal or tangential to each relevant portion of the closed surface, making the dot product equal to $D\,dS$ or zero. Second, the field magnitude must be constant over every surface portion through which nonzero flux passes. Under these conditions, the unknown magnitude can be moved outside the integral and the remaining integral is simply an area. Before selecting a surface, one must determine which coordinates the field depends on and which vector components can exist. Spherical symmetry suggests a centered sphere, cylindrical symmetry suggests a coaxial cylinder, and planar symmetry suggests a pillbox-like surface. Symmetry is not merely a convenience in these derivations. Without a justified symmetry argument, Gauss's law still gives net flux but usually cannot isolate the field magnitude. The method is particularly valuable where direct use of Coulomb's law would require difficult integration.

### Key planning details

- Determine the allowed field components before choosing a gaussian surface.
- Determine which coordinates can affect the field magnitude.
- Choose surface portions where the field is normal or tangential.
- Require constant field magnitude wherever the flux contribution is nonzero.
- Replace $\mathbf{D}\cdot d\mathbf{S}$ by $D\,dS$ on normal portions.
- Set the flux contribution to zero on tangential portions.
- Equate field magnitude times effective area to enclosed charge.
- Do not infer a detailed field from Gauss's law without adequate symmetry.

### Source coverage

- Page 68 lists the two conditions needed for a simple gaussian-surface solution.
- Page 68 explains that $D_S$ can be removed from the integral when it is constant over the contributing surface.
- Page 69 requires identifying the coordinates on which $\mathbf{D}$ depends and the components that are present.
- Page 69 states that application of Gauss's law depends on symmetry rather than merely being simplified by it.
- Pages 69 through 72 apply the method to line charge and coaxial conductor geometries.
