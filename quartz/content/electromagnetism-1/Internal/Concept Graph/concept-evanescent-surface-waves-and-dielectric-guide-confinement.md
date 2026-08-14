---
title: "Evanescent Surface Waves and Dielectric-Guide Confinement"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "evanescent-surface-waves-and-dielectric-guide-confinement"
locations: ["Page 508, Section 13.6.2 and Eqs. (131)-(134)", "Page 509, Eq. (135) and surface-wave interpretation"]
related: ["symmetric-dielectric-slab-waveguide-and-total-internal-reflection", "piecewise-slab-mode-fields-and-frequency-dependent-confinement", "weakly-guiding-step-index-fiber-and-lp-modes"]
---

## ConceptNode: Evanescent Surface Waves and Dielectric-Guide Confinement

Planning node for [[evanescent-surface-waves-and-dielectric-guide-confinement|1.291 Evanescent Surface Waves and Dielectric-Guide Confinement]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 508, Section 13.6.2 and Eqs. (131)-(134), Page 509, Eq. (135) and surface-wave interpretation

Under total internal reflection, the transmitted wave angle in the surrounding material gives an imaginary transverse wavevector component. Writing $\kappa_2=-j\gamma_2$ converts the exterior field into an exponential decay away from each interface while preserving propagation along z through $e^{-j\beta z}$. Above the slab, the field varies as $e^{-\gamma_2(x-d/2)}$; below it, the field varies as $e^{\gamma_2(x+d/2)}$. These are surface waves: they carry part of the mode power along the guide but do not propagate away from the slab in the transverse direction. Their presence means the electromagnetic cross section is not limited to the physical slab and is mathematically infinite. In practice, the exponential decay usually makes the fields negligible within a few slab thicknesses. The decay coefficient grows with internal angle and therefore changes both with frequency and mode order, providing a quantitative measure of how tightly the mode is confined.

### Key planning details

- Total internal reflection makes the exterior transverse wavevector imaginary.
- Define $\kappa_2=-j\gamma_2$ with real positive decay coefficient $\gamma_2$.
- Exterior fields propagate along z but decay exponentially with distance from the slab.
- Surface waves carry a nonzero fraction of the guided power.
- The dielectric mode extends beyond the nominal guide boundaries.
- Larger $\gamma_2$ produces faster decay and tighter confinement.

### Source coverage

- Equation (131) begins with the upper-region field $E_{y2}=E_{02}e^{-j\kappa_2x}e^{-j\beta z}$.
- Equation (132): $$\kappa_2=-j\gamma_2.$$
- Equation (133) derives $\gamma_2$ from $n_1$, $n_2$, $k_0$, and $\theta_1$.
- Equation (134): $$E_{y2}=E_{02}e^{-\gamma_2(x-d/2)}e^{-j\beta z},\qquad x>d/2.$$
- Equation (135): $$E_{y2}=E_{02}e^{\gamma_2(x+d/2)}e^{-j\beta z},\qquad x<-d/2.$$
- Page 509 identifies these exterior fields as surface waves and states that guided power extends beyond the dielectric boundaries.
