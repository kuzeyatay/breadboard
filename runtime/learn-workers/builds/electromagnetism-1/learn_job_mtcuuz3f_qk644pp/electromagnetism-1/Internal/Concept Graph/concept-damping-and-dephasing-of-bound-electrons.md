---
title: "Damping and Dephasing of Bound Electrons"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "damping-and-dephasing-of-bound-electrons"
locations: ["Page 585, damping and dephasing discussion", "Page 587, Figure E.2 interpretation"]
related: ["lorentz-bound-electron-oscillator", "driven-oscillator-equation-and-phasor-solution", "near-resonance-absorption-line-shape"]
---

## ConceptNode: Damping and Dephasing of Bound Electrons

Planning node for [[damping-and-dephasing-of-bound-electrons|1.355 Damping and Dephasing of Bound Electrons]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 585, damping and dephasing discussion, Page 587, Figure E.2 interpretation

A bound electron does not oscillate indefinitely because it interacts and collides with neighboring oscillators. The Lorentz model represents these effects with a velocity-dependent damping force, $$F_d(z,t)=-m\gamma_d v(z,t),$$ where $m$ is the electron mass, $v$ is its velocity, and $\gamma_d$ is the damping coefficient. Damping is associated with dephasing among the oscillators. While the applied sinusoidal field imposes a definite relative phase, collisions progressively destroy that phase relationship. After the field is removed, the organized response decays exponentially toward random phase. The source states that the $1/e$ dephasing time is $2/\gamma_d$. Because the damped oscillator is driven at angular frequency $\omega$, its displacement amplitude depends on frequency, much like the response of a sinusoidally driven RLC circuit. The damping coefficient therefore affects both the magnitude of the loss and the spectral width of the absorption response. In the resulting susceptibility curve, stronger damping produces a broader resonance feature.

### Key planning details

- Neighbor interactions and collisions damp electron motion.
- The damping force is proportional to velocity.
- $F_d=-m\gamma_d v$ defines the damping coefficient $\gamma_d$.
- Collisions destroy the phase coherence imposed by the driving field.
- The stated $1/e$ dephasing time is $2/\gamma_d$.
- The driven response is frequency-dependent in a manner analogous to an RLC circuit.

### Source coverage

- Equation (E.9): $$F_d(z,t)=-m\gamma_d v(z,t).$$
- Page 585 states that oscillator phasing dies away exponentially after coherent driving is removed.
- The source gives the dephasing time as $2/\gamma_d$.
- The displacement magnitude is compared with the frequency response of a sinusoidally driven RLC circuit.
- Figure E.2 later connects $\gamma_d$ to the full width at half maximum of the absorption curve.
