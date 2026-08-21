---
title: "Finite Straight Current Filaments and Superposition"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "finite-straight-current-filaments-superposition"
locations: ["Page 200", "Page 201", "Page 202", "Equation 7.9", "Example 7.1", "Figure S1.P200.F1", "Figure S1.P201.F1", "Exercises D7.1-D7.2"]
related: ["magnetic-field-infinite-straight-current-filament", "differential-biot-savart-law", "current-source-representations"]
---

## ConceptNode: Finite Straight Current Filaments and Superposition

Planning node for [[finite-straight-current-filaments-superposition|1.106 Finite Straight Current Filaments and Superposition]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 200, Page 201, Page 202, Equation 7.9, Example 7.1, Figure S1.P200.F1, Figure S1.P201.F1, Exercises D7.1-D7.2

For a finite straight current filament, the magnetic field at a point a perpendicular distance $\rho$ from the filament is conveniently expressed using endpoint angles $\alpha_1$ and $\alpha_2$:

$$\mathbf{H}=\frac{I}{4\pi\rho}(\sin\alpha_2-\sin\alpha_1)\mathbf{a}_\phi.$$

Angles associated with endpoints below the field point are negative according to the geometry used in the text. This result supports piecewise analysis of conductors composed of multiple straight segments. Example 7.1 applies it to an 8 A current that travels inward along the positive $x$ axis to the origin and then outward along the positive $y$ axis. At $P_2(0.4,0.3,0)$, the semi-infinite $x$ segment contributes $-(12/\pi)\mathbf{a}_z$ A/m, while the $y$ segment contributes $-(8/\pi)\mathbf{a}_z$ A/m. Vector superposition gives $\mathbf{H}_2=-(20/\pi)\mathbf{a}_z=-6.37\mathbf{a}_z$ A/m. Correctly translating each local azimuthal direction into a common coordinate basis is essential.

### Key planning details

- Finite-filament fields depend on the perpendicular distance and endpoint angles.
- The formula is $\mathbf{H}=I(\sin\alpha_2-\sin\alpha_1)\mathbf{a}_\phi/(4\pi\rho)$.
- Endpoint angles may be negative when endpoints lie below the field point.
- A segmented conductor is handled by calculating each segment field separately.
- Each segment's local $\mathbf{a}_\phi$ must be converted to a common vector basis.
- The total field is the vector sum of segment contributions.
- Example 7.1 produces $-6.37\mathbf{a}_z$ A/m at the specified point.

### Source coverage

- Figure S1.P200.F1 defines $\rho$, $\alpha_1$, and $\alpha_2$ for a finite filament.
- Page 200 gives $\mathbf{H}=I(\sin\alpha_2-\sin\alpha_1)\mathbf{a}_\phi/(4\pi\rho)$.
- Page 201 sets $\alpha_{1x}=-90^\circ$, $\alpha_{2x}=53.1^\circ$, and $\rho_x=0.3$ for the first segment.
- Page 201 converts the first local azimuthal direction to $-\mathbf{a}_z$.
- Page 201 calculates the second contribution as $-(8/\pi)\mathbf{a}_z$ A/m.
- Figure S1.P201.F1 shows the two semi-infinite segments and their superposed fields.
- Page 202 exercises D7.1 and D7.2 test differential-element evaluation and rectangular-coordinate expressions for an infinite filament.
