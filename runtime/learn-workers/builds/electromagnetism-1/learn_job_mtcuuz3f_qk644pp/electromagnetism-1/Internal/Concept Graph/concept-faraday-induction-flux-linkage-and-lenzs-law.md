---
title: "Faraday Induction, Flux Linkage, and Lenz's Law"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "faraday-induction-flux-linkage-and-lenzs-law"
locations: ["Page 292", "Page 293"]
related: ["transition-from-static-fields-to-time-varying-electromagnetics", "transformer-emf-and-the-differential-form-of-faradays-law", "motional-emf-and-moving-conductors", "self-inductance-mutual-inductance-and-flux-linkage"]
---

## ConceptNode: Faraday Induction, Flux Linkage, and Lenz's Law

Planning node for [[faraday-induction-flux-linkage-and-lenzs-law|1.142 Faraday Induction, Flux Linkage, and Lenz's Law]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 292, Page 293

Faraday's law relates induced electromotive force to the time rate of change of magnetic flux through a closed path: $$\mathrm{emf}=-\frac{d\Phi}{dt}.$$ The path need not be a conducting wire. It may include a capacitor or may be an imaginary closed curve in space. The flux $\Phi$ is computed through a surface bounded by that path. A nonzero flux derivative can result from a time-changing magnetic field through a stationary path, relative motion between a steady field and the path, or both. The minus sign expresses Lenz's law: the induced voltage has the direction that would drive a current whose magnetic flux opposes the change responsible for the emf. For an $N$-turn filamentary winding whose turns can be treated as coincident, the law becomes $$\mathrm{emf}=-N\frac{d\Phi}{dt}.$$ Electromotive force is defined by the closed line integral $$\mathrm{emf}=\oint\mathbf{E}\cdot d\mathbf{L}.$$ Substituting the magnetic-flux surface integral yields the general flux form, with path direction and surface normal linked by the right-hand rule.

### Key planning details

- Faraday's law is $\mathrm{emf}=-d\Phi/dt$.
- The law applies to a closed path that need not be entirely conducting.
- Flux change may come from time variation, relative motion, or both.
- Lenz's law determines the opposing sign and direction of the induced response.
- For coincident $N$-turn windings, $\mathrm{emf}=-N\,d\Phi/dt$.
- Electromotive force is the closed-path voltage $\oint\mathbf{E}\cdot d\mathbf{L}$.
- The right-hand rule links positive path direction to the chosen surface normal.

### Source coverage

- Equation (1) states $\mathrm{emf}=-d\Phi/dt$.
- The source lists three causes of nonzero $d\Phi/dt$: changing flux, relative motion, and their combination.
- The minus sign is identified with Lenz's law and an opposing induced flux.
- Equation (2) gives $\mathrm{emf}=-N\,d\Phi/dt$ for an $N$-turn filamentary conductor.
- Equation (3) defines $\mathrm{emf}=\oint\mathbf{E}\cdot d\mathbf{L}$.
- Equation (4) writes $\oint\mathbf{E}\cdot d\mathbf{L}=-\frac{d}{dt}\int_S\mathbf{B}\cdot d\mathbf{S}$.
