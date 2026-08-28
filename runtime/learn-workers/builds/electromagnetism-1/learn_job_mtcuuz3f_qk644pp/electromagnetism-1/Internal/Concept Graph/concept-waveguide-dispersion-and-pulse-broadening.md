---
title: "Waveguide Dispersion and Pulse Broadening"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "waveguide-dispersion-and-pulse-broadening"
locations: ["Page 525", "Problems 13.24-13.25"]
related: ["guided-mode-cutoff-and-single-mode-operation", "waveguide-power-flow-and-field-structure", "mode-confinement-and-mode-field-radius-in-step-index-fiber"]
---

## ConceptNode: Waveguide Dispersion and Pulse Broadening

Planning node for [[waveguide-dispersion-and-pulse-broadening|1.304 Waveguide Dispersion and Pulse Broadening]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 525, Problems 13.24-13.25

Waveguide dispersion arises because the propagation constant $\beta$ is a nonlinear function of angular frequency near a modal cutoff. The second derivative $d^2\beta/d\omega^2$ quantifies group-velocity dispersion and therefore predicts the spreading of a finite-bandwidth pulse. The expression supplied in the problem depends on refractive index $n$, angular frequency $\omega$, vacuum light speed $c$, and modal cutoff angular frequency $\omega_c$. Its negative sign and rapidly increasing magnitude as $\omega$ approaches $\omega_c$ show that operation near cutoff produces strong dispersion. The factor $[1-(\omega_c/\omega)^2]^{-3/2}$ becomes especially large when the operating frequency is only slightly above cutoff. The accompanying pulse problem applies this parameter to a transform-limited 10 GHz pulse in a single-mode, air-filled rectangular guide whose operating frequency is only 1.1 times the $\mathrm{TE}_{10}$ cutoff. The requested broadening length connects the frequency-domain curvature of $\beta$ to a measurable time-domain pulse width. The suggested mitigation follows directly from the formula: operate farther above cutoff, subject to preserving single-mode operation, to reduce the dispersion magnitude.

### Key planning details

- Group dispersion is measured by $d^2\beta/d\omega^2$.
- Dispersion depends strongly on the ratio $\omega_c/\omega$.
- The dispersion magnitude grows rapidly as operation approaches cutoff.
- A finite-bandwidth pulse broadens because its frequency components accumulate different group delays.
- The pulse example uses a 10 GHz center frequency and full width $2T=1.0\,\mathrm{ns}$.
- The operating frequency is specified as $1.1$ times the $\mathrm{TE}_{10}$ cutoff.
- Operating farther above cutoff reduces pulse broadening if the guide remains single mode.

### Source coverage

- Problem 13.24 gives $$\frac{d^2\beta}{d\omega^2}=-\frac{n}{\omega c}\left(\frac{\omega_c}{\omega}\right)^2\left[1-\left(\frac{\omega_c}{\omega}\right)^2\right]^{-3/2}.$$
- The formula applies to a given mode in a parallel-plate or rectangular waveguide.
- Problem 13.25 specifies a transform-limited pulse with $f=10\,\mathrm{GHz}$ and $2T=1.0\,\mathrm{ns}$.
- The guide is lossless, air-filled, single mode, and operated at $1.1$ times the $\mathrm{TE}_{10}$ cutoff.
