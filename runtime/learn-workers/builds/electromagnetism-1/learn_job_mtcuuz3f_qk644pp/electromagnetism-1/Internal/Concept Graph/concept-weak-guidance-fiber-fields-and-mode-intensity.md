---
title: "Weak-Guidance Fiber Fields and Mode Intensity"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "weak-guidance-fiber-fields-and-mode-intensity"
locations: ["Page 515, Eqs. (150a)-(150b)", "Page 516, Eqs. (151)-(153) and mode-index interpretation"]
related: ["cylindrical-wave-equation-and-bessel-function-solutions", "fiber-eigenvalue-equation-and-normalized-frequency", "lp-01-and-lp-11-intensity-profiles"]
---

## ConceptNode: Weak-Guidance Fiber Fields and Mode Intensity

Planning node for [[weak-guidance-fiber-fields-and-mode-intensity|1.296 Weak-Guidance Fiber Fields and Mode Intensity]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 515, Eqs. (150a)-(150b), Page 516, Eqs. (151)-(153) and mode-index interpretation

The transverse fiber parameters are normalized by the core radius to define $u=a\sqrt{n_1^2k_0^2-\beta^2}$ in the core and $w=a\sqrt{\beta^2-n_2^2k_0^2}$ in the cladding. Both regions share the same propagation constant $\beta$ so their boundary fields can agree for every z and time. A guided LP mode has an oscillatory $J_\ell(u\rho/a)$ profile inside the core and a decaying $K_\ell(w\rho/a)$ profile outside. The cladding coefficient is selected so that the transverse electric field is continuous at $\rho=a$ under weak guidance. Approximating $H_y\doteq E_x/\eta$ then makes the average intensity proportional to $|E_x|^2/(2\eta)$. The angular factor $\cos^2(\ell\phi)$ shows that $2\ell$ counts intensity variations around the fiber. The radial mode number m selects progressively larger allowed u ranges, causing additional Bessel oscillations and radial maxima as m increases.

### Key planning details

- The dimensionless core parameter is $u=a\sqrt{n_1^2k_0^2-\beta^2}$.
- The dimensionless cladding parameter is $w=a\sqrt{\beta^2-n_2^2k_0^2}$.
- The same $\beta$ applies in the core and cladding.
- Core fields use $J_\ell(u\rho/a)$ and cladding fields use $K_\ell(w\rho/a)$.
- The field coefficients enforce approximate continuity at the core-cladding boundary.
- Weak guidance gives intensity $I=|E_x|^2/(2\eta)$.
- The index $\ell$ determines angular intensity variation and Bessel-function order.
- The index m determines the number of radial intensity variations.

### Source coverage

- Equations (150a)-(150b): $$u=a\sqrt{n_1^2k_0^2-\beta^2},\qquad w=a\sqrt{\beta^2-n_2^2k_0^2}.$$
- Equation (151) gives the piecewise electric field with $J_\ell$ in the core and $K_\ell$ in the cladding.
- The coefficient $J_\ell(u)/K_\ell(w)$ makes the two electric-field expressions equal at $\rho=a$.
- Equation (152): $$|\langle\mathbf{S}\rangle|=\frac{1}{2\eta}|E_x|^2.$$
- Equations (153a)-(153b) give the core and cladding intensities proportional to $J_\ell^2\cos^2(\ell\phi)$ and $K_\ell^2\cos^2(\ell\phi)$.
- The source explains that increasing m permits larger u and more radial Bessel oscillations.
