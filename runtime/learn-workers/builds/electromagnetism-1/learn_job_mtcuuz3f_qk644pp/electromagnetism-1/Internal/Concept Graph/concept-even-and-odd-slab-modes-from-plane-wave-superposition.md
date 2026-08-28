---
title: "Even and Odd Slab Modes from Plane-Wave Superposition"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "even-and-odd-slab-modes-from-plane-wave-superposition"
locations: ["Page 507, Eq. (126)", "Page 508, Eqs. (127)-(130)"]
related: ["symmetric-dielectric-slab-waveguide-and-total-internal-reflection", "evanescent-surface-waves-and-dielectric-guide-confinement", "piecewise-slab-mode-fields-and-frequency-dependent-confinement"]
---

## ConceptNode: Even and Odd Slab Modes from Plane-Wave Superposition

Planning node for [[even-and-odd-slab-modes-from-plane-wave-superposition|1.290 Even and Odd Slab Modes from Plane-Wave Superposition]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 507, Eq. (126), Page 508, Eqs. (127)-(130)

Inside the symmetric slab, a TE mode can be built by superposing two plane waves with equal longitudinal component $\beta$ and opposite transverse components $\pm\kappa_1$. Adding the waves produces an even transverse field proportional to $\cos(\kappa_1x)$, while subtracting them produces an odd field proportional to $\sin(\kappa_1x)$. Both retain the common propagation factor $e^{-j\beta z}$. The two parity choices are expected because the physical guide is symmetric about its central plane. The transverse wavenumber is $\kappa_1=n_1k_0\cos\theta_1$, so at a fixed frequency a larger $\kappa_1$ corresponds to a smaller internal ray angle. It also produces more spatial oscillations across the slab, linking larger transverse wavenumber to higher-order modes. This plane-wave construction provides the oscillatory interior portions of the complete piecewise mode fields. Boundary matching later fixes their amplitudes relative to the evanescent fields outside the slab.

### Key planning details

- The upward and downward core waves have transverse components $+\kappa_1$ and $-\kappa_1$.
- Both core waves have the same longitudinal propagation constant $\beta$.
- The sum of the waves gives an even cosine field.
- The difference of the waves gives an odd sine field.
- Both parity classes have symmetric intensity distributions.
- Larger $\kappa_1$ means more transverse oscillations and a higher-order mode.
- At fixed frequency, increasing $\kappa_1$ corresponds to decreasing $\theta_1$.

### Source coverage

- Equation (126) superposes two TE plane waves inside $-d/2<x<d/2$.
- Equations (127)-(128): $$\mathbf{k}_{1u}=\kappa_1\mathbf{a}_x+\beta\mathbf{a}_z,\qquad \mathbf{k}_{1d}=-\kappa_1\mathbf{a}_x+\beta\mathbf{a}_z.$$
- Equation (129): $$E_{y1}=2E_0\cos(\kappa_1x)e^{-j\beta z}.$$
- Equation (130), after choosing the difference of the component waves: $$E_{y1}=2jE_0\sin(\kappa_1x)e^{-j\beta z}.$$
- The source states $\kappa_1=n_1k_0\cos\theta_1$ and associates higher-order modes with larger $\kappa_1$.
