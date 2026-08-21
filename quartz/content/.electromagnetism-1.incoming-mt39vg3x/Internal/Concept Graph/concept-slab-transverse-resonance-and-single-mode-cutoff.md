---
title: "Slab Transverse Resonance and Single-Mode Cutoff"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "slab-transverse-resonance-and-single-mode-cutoff"
locations: ["Page 511, Section 13.6.4 and Eqs. (139)-(143)", "Page 511, single-mode slab example", "Page 512, Problem D13.11"]
related: ["piecewise-slab-mode-fields-and-frequency-dependent-confinement", "symmetric-dielectric-slab-waveguide-and-total-internal-reflection", "fiber-eigenvalue-equation-and-normalized-frequency", "single-mode-step-index-fiber"]
---

## ConceptNode: Slab Transverse Resonance and Single-Mode Cutoff

Planning node for [[slab-transverse-resonance-and-single-mode-cutoff|1.293 Slab Transverse Resonance and Single-Mode Cutoff]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 511, Section 13.6.4 and Eqs. (139)-(143), Page 511, single-mode slab example, Page 512, Problem D13.11

Allowed slab modes must reproduce their phase after a transverse round trip through the core and two total reflections. For TE waves the round-trip phase is $2\kappa_1d+2\phi_{TE}$, and for TM waves it is $2\kappa_1d+2\phi_{TM}$. Setting either expression equal to $2m\pi$ gives the slab eigenvalue equations. Because both the transverse wavenumber and reflection phase depend differently on $\theta_1$, these equations are transcendental and require numerical or graphical solution. Their cutoff consequence is simpler: mode m propagates when $k_0d\sqrt{n_1^2-n_2^2}\geq(m-1)\pi$. The integer m counts transverse half-cycles of electric field for TE modes or magnetic field for TM modes. The lowest mode, $m=1$, has no cutoff. Suppressing the $m=2$ modes gives the single-mode-pair condition $k_0d\sqrt{n_1^2-n_2^2}<\pi$, equivalently $\lambda>2d\sqrt{n_1^2-n_2^2}$. The worked optical example uses this inequality to constrain the slab refractive index.

### Key planning details

- A transverse round trip must accumulate an integer multiple of $2\pi$ phase.
- TE and TM eigenvalue equations differ through their reflection phases.
- The eigenvalue equations are transcendental in the internal wave angle.
- Mode m propagates when $k_0d\sqrt{n_1^2-n_2^2}\geq(m-1)\pi$.
- The mode number counts transverse field half-cycles.
- The $m=1$ TE and TM modes have no cutoff.
- Single-mode-pair operation requires the $m=2$ modes to remain below cutoff.
- The wavelength condition is $\lambda>2d\sqrt{n_1^2-n_2^2}$.

### Source coverage

- Equation (139): $$2\kappa_1d+2\phi_{TE}=2m\pi.$$
- Equation (140): $$2\kappa_1d+2\phi_{TM}=2m\pi.$$
- Equation (141): $$k_0d\sqrt{n_1^2-n_2^2}\geq(m-1)\pi.$$
- Equation (142): $$k_0d\sqrt{n_1^2-n_2^2}<\pi.$$
- Equation (143): $$\lambda>2d\sqrt{n_1^2-n_2^2}.$$
- For $\lambda=1.30\,\mu\mathrm{m}$, $d=5.00\,\mu\mathrm{m}$, and $n_2=1.450$, the source obtains $n_1<1.456$.
- Problem D13.11 states that a 0.5 mm glass slab with $n_1=1.45$, air cladding, and $\lambda=1.0\,\mu$m supports 2102 TE and TM modes.
