---
title: "Physical Meaning of Curl"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "physical-meaning-of-curl"
locations: ["Page 212", "Page 213", "Page 214", "Section 7.3.2: Physical Meaning of Curl", "Figure S1.P213.F1"]
related: ["curl-circulation-per-unit-area", "coordinate-formulas-for-curl", "magnetic-field-infinite-straight-current-filament", "point-form-of-amperes-law"]
---

## ConceptNode: Physical Meaning of Curl

Planning node for [[physical-meaning-of-curl|1.114 Physical Meaning of Curl]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 212, Page 213, Page 214, Section 7.3.2: Physical Meaning of Curl, Figure S1.P213.F1

Curl measures local circulation density rather than merely the visual curvature of field lines. A small paddle wheel provides the physical analogy: no rotation indicates zero curl about its axis, greater torque indicates a larger curl component, and reversal of rotation indicates a sign reversal. The full curl direction is the wheel-axis orientation producing the greatest torque, with its sign determined by the right-hand rule. A river whose speed increases from the bottom toward the surface rotates such a wheel because opposite blades encounter different velocities. By contrast, the magnetic field around an infinite filament has curved circular streamlines but zero curl everywhere away from the filament. Substituting $\mathbf{H}=(I/2\pi\rho)\mathbf{a}_\phi$ into the cylindrical formula gives

$$\nabla\times\mathbf{H}=\frac{1}{\rho}\frac{\partial(\rho H_\phi)}{\partial\rho}\mathbf{a}_z=0,$$

because $\rho H_\phi=I/(2\pi)$ is constant. Curved field lines therefore do not by themselves imply nonzero curl.

### Key planning details

- Curl is local circulation per unit area.
- The paddle-wheel analogy tests the rotational tendency of a vector field.
- Curl direction follows the paddle-wheel axis and the right-hand rule.
- Velocity shear in a river can produce nonzero curl.
- Curved streamlines do not necessarily imply nonzero curl.
- The infinite-filament field has zero curl at points away from the current.
- For magnetostatic fields, nonzero curl corresponds locally to current density.

### Source coverage

- Page 213 defines circulation as the closed line integral of a field.
- Page 213 describes curl as circulation per unit area at a point.
- Figure S1.P213.F1 shows a paddle-wheel curl meter in a river velocity field and in the field around a filament.
- Pages 213-214 explain how rotation magnitude and direction indicate curl magnitude and sign.
- Page 214 notes that the filament field's curved lines can still produce zero net paddle-wheel torque.
- Page 214 substitutes $H_\phi=I/(2\pi\rho)$ into the cylindrical curl formula and obtains zero.
