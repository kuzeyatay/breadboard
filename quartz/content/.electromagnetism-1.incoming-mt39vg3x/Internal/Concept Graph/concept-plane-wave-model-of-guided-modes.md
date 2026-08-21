---
title: "Plane-Wave Model of Guided Modes"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "plane-wave-model-of-guided-modes"
locations: ["Page 480, Figure 13.11", "Page 482, Section 13.3 and Figure 13.13", "Page 483, Section 13.3.1 and Figure 13.14", "Page 484, Equation (36)"]
related: ["transverse-resonance-and-mode-quantization", "parallel-plate-mode-propagation-and-cutoff", "te-mode-fields-from-plane-wave-superposition", "phase-and-group-velocities-in-a-waveguide"]
---

## ConceptNode: Plane-Wave Model of Guided Modes

Planning node for [[plane-wave-model-of-guided-modes|1.269 Plane-Wave Model of Guided Modes]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 480, Figure 13.11, Page 482, Section 13.3 and Figure 13.13, Page 483, Section 13.3.1 and Figure 13.14, Page 484, Equation (36)

A non-TEM mode in a parallel-plate guide can be interpreted as a pair of plane waves repeatedly reflecting between the conducting plates while making net progress along $z$. The upward and downward wavevectors, $\mathbf{k}_u$ and $\mathbf{k}_d$, have equal magnitude $k=\omega\sqrt{\mu\epsilon}$ but opposite transverse components. A guided mode exists only when all upward-propagating waves are mutually in phase and all downward-propagating waves are likewise in phase. This phase-coincidence requirement restricts the incidence angle to discrete values. Each allowed angle and its corresponding interference field pattern define one mode. Figure 13.13 contrasts a nonmodal angle, for which successive upward-wave phase fronts do not coincide, with an adjusted angle that produces coincident fronts and guided propagation. The wavevector is decomposed into transverse and axial phase constants, $\kappa_m$ and $\beta_m$, satisfying $$\beta_m=\sqrt{k^2-\kappa_m^2}.$$ The mode number $m$ labels the permitted discrete directions rather than changing the magnitude of the constituent plane-wave vectors.

### Key planning details

- The constituent plane waves have magnitude $k=\omega\sqrt{\mu\epsilon}$.
- Upward and downward waves have opposite transverse wavevector components.
- A guided mode requires coincident phase fronts among repeated waves traveling in the same transverse direction.
- Only discrete incidence angles satisfy the phase-coincidence requirement.
- The transverse and axial components obey $k^2=\kappa_m^2+\beta_m^2$.
- $\beta_m$ measures phase shift per unit distance along the guide.
- Changing mode number changes wavevector direction, not its magnitude at fixed frequency.

### Source coverage

- Figure 13.11 depicts zig-zag propagation by oblique reflection from conducting walls.
- The source gives $|\mathbf{k}_u|=|\mathbf{k}_d|=k=\omega\sqrt{\mu\epsilon}$.
- Figure 13.13(a) shows noncoincident phase fronts, while Figure 13.13(b) shows the angle adjusted to establish a guided mode.
- Figure 13.14 resolves the upward wavevector into $\kappa_m$ and $\beta_m$.
- Equation (35) gives $\beta_m=\sqrt{k^2-\kappa_m^2}$.
- For a lossless nonmagnetic dielectric, Equation (36) gives $k=\omega n/c$.
