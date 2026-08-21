---
title: "Single-Mode Step-Index Fiber"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "single-mode-step-index-fiber"
locations: ["Page 518, Section 13.7.3, Eqs. (158)-(159), and Example 13.6"]
related: ["fiber-eigenvalue-equation-and-normalized-frequency", "lp-01-and-lp-11-intensity-profiles", "slab-transverse-resonance-and-single-mode-cutoff"]
---

## ConceptNode: Single-Mode Step-Index Fiber

Planning node for [[single-mode-step-index-fiber|1.298 Single-Mode Step-Index Fiber]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 518, Section 13.7.3, Eqs. (158)-(159), and Example 13.6

The fundamental LP_01 mode has no cutoff because its cutoff condition uses the zero of $J_1$ at $V=0$. The next mode is LP_11, whose cutoff is the first positive zero of $J_0$, namely 2.405. A step-index fiber therefore operates in a single spatial mode when $0<V<2.405$, usually written $V<2.405$. Substituting $V=ak_0\sqrt{n_1^2-n_2^2}$ and $k_0=2\pi/\lambda$ converts this into a lower bound on free-space wavelength. The resulting cutoff wavelength is associated with the onset of LP_11 and is commonly supplied as a commercial fiber specification. Longer operating wavelengths reduce V and favor single-mode behavior, while increasing core radius or index contrast raises V and permits higher-order modes. In the worked example, a fiber with quoted cutoff wavelength $1.20\,\mu$m operated at $1.55\,\mu$m has $V=1.86$, safely below 2.405.

### Key planning details

- LP_01 has cutoff $V_c(01)=0$ and therefore propagates without a nonzero cutoff.
- LP_11 is the next higher-order mode.
- The LP_11 cutoff is $V_c(11)=2.405$.
- Single-mode operation requires $V<2.405$.
- The equivalent wavelength condition is $\lambda>\lambda_c$.
- The specified fiber cutoff wavelength is the LP_11 cutoff wavelength.
- A larger wavelength lowers V for a fixed fiber.
- For $\lambda_c=1.20\,\mu$m and $\lambda=1.55\,\mu$m, $V=1.86$.

### Source coverage

- Equation (158): $$V<V_c(11)=2.405.$$
- Equation (159): $$\lambda>\lambda_c=\frac{2\pi a}{2.405}\sqrt{n_1^2-n_2^2}.$$
- The source identifies $\lambda_c$ as the cutoff wavelength of LP_11 and notes that it is quoted for commercial single-mode fiber.
- Example 13.6 uses $$V=2.405\frac{\lambda_c}{\lambda}.$$
- For $\lambda_c=1.20\,\mu\mathrm{m}$ and $\lambda=1.55\,\mu\mathrm{m}$, the source calculates $V=1.86$.
- The source explicitly notes the similarity between the fiber single-mode condition and the slab-waveguide condition.
