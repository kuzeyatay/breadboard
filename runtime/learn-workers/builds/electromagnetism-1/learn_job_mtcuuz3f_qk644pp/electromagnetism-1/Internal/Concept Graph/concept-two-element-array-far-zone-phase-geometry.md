---
title: "Two-Element Array Far-Zone Phase Geometry"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "two-element-array-far-zone-phase-geometry"
locations: ["Page 549", "Page 550", "Page 551", "Section 14.5", "Section 14.5.1", "Figure 14.11", "Figure 14.12"]
related: ["pattern-multiplication-for-antenna-arrays", "broadside-and-endfire-two-element-arrays", "uniform-linear-array-factor"]
---

## ConceptNode: Two-Element Array Far-Zone Phase Geometry

Planning node for [[two-element-array-far-zone-phase-geometry|1.325 Two-Element Array Far-Zone Phase Geometry]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 549, Page 550, Page 551, Section 14.5, Section 14.5.1, Figure 14.11, Figure 14.12

A two-element array extends directional control beyond what is possible with a single vertical wire. The source places two identical $z$-directed antennas along the $x$ axis, separated by distance $d$. Both carry current amplitude $I_0$, while the second has a fixed current phase shift $\xi$. At a far-zone point $(r,\theta,\phi)$, the rays from the two elements are approximately parallel and their electric fields share the $\mathbf a_\theta$ direction. The second path length is found by projecting the separation vector onto the radial direction. This projection is $s=d\mathbf a_x\cdot\mathbf a_r=d\sin\theta\cos\phi$, giving $r_1\simeq r-d\sin\theta\cos\phi$. As in the finite-dipole derivation, the small path difference is ignored in the amplitude denominator but retained in phase. Combining the imposed current phase with the propagation phase produces the net observed phase difference $\psi=\xi+kd\sin\theta\cos\phi$. This phase controls constructive and destructive interference as a function of observation direction.

### Key planning details

- The array contains two identical parallel antennas separated by $d$ along the $x$ axis.
- The second antenna current has phase shift $\xi$ relative to the first.
- Far-zone rays from the two antennas are treated as parallel.
- The separation projection is $s=d\sin\theta\cos\phi$.
- The second path length is $r_1\simeq r-d\sin\theta\cos\phi$.
- Path differences are neglected in amplitude but retained in phase.
- The observed phase difference is $\psi=\xi+kd\sin\theta\cos\phi$.
- The displaced element introduces $\phi$ dependence that a single vertical dipole lacks.

### Source coverage

- Figure S26.P549.F14.11 shows two parallel $z$-directed antennas separated by $d$ along $x$, with relative current phase $\xi$.
- Figure S26.P550.F14.12 gives the top-view far-field geometry and the approximation $r_1\simeq r-s$.
- Equation (67), Page 550 sums the two individual antenna fields.
- Equation (68), Page 550 gives $s=d\sin\theta\cos\phi$.
- Equation (69), Page 550 gives $r_1\simeq r-d\sin\theta\cos\phi$.
- Equation (72), Page 551 defines $\psi=\xi+kd\sin\theta\cos\phi$.
