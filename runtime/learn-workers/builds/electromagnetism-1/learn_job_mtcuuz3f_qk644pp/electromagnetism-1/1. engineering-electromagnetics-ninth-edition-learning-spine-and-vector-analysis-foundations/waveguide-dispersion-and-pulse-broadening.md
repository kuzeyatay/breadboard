---
title: "1.304 Waveguide Dispersion and Pulse Broadening"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 525", "Problems 13.24-13.25"]
related: ["guided-mode-cutoff-and-single-mode-operation", "waveguide-power-flow-and-field-structure", "mode-confinement-and-mode-field-radius-in-step-index-fiber"]
---

# 1.304 Waveguide Dispersion and Pulse Broadening

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 525, Problems 13.24-13.25

Waveguide dispersion arises because the propagation constant $\beta$ is a nonlinear function of angular frequency near a modal cutoff. The second derivative $d^2\beta/d\omega^2$ quantifies group-velocity dispersion and therefore predicts the spreading of a finite-bandwidth pulse. The expression supplied in the problem depends on refractive index $n$, angular frequency $\omega$, vacuum light speed $c$, and modal cutoff angular frequency $\omega_c$. Its negative sign and rapidly increasing magnitude as $\omega$ approaches $\omega_c$ show that operation near cutoff produces strong dispersion. The factor $[1-(\omega_c/\omega)^2]^{-3/2}$ becomes especially large when the operating frequency is only slightly above cutoff. The accompanying pulse problem applies this parameter to a transform-limited 10 GHz pulse in a single-mode, air-filled rectangular guide whose operating frequency is only 1.1 times the $\mathrm{TE}_{10}$ cutoff. The requested broadening length connects the frequency-domain curvature of $\beta$ to a measurable time-domain pulse width. The suggested mitigation follows directly from the formula: operate farther above cutoff, subject to preserving single-mode operation, to reduce the dispersion magnitude.

## Page-Grounded Details

#### Page 525

Figure 13.26 See Problem 13.29.

13.24  Show that the group dispersion parameter, $d^{2}\beta/d\omega^{2}$, for a given mode in a parallel-plate or rectangular waveguide is given by
$$
\frac{d^{2}\beta}{d\omega^{2}}=-\frac{n}{\omega c}(\frac{\omega_{c}}{\omega})^{2}\left[1-(\frac{\omega_{c}}{\omega})^{2}\right]^{-3/2}
$$
where $\omega_{c}$ is the radian cutoff frequency for the mode in question [note that the first derivative form was already found, resulting in Eq. (57)].

13.25 Consider a transform-limited pulse of center frequency $f=10$ GHz, and of full-width $2T=1.0$ ns. The pulse propagates in a lossless single-mode rectangular guide which is air-filled and in which the 10 GHz operating frequency is 1.1 times the cutoff frequency of the TE_10 mode. Using the result of Problem 13.24, determine the length of guide over which the pulse broadens to twice its initial width. What simple step can be taken to reduce the amount of pulse broadening in this guide, while maintaining the same initial pulse width? Additional background for this problem is found in Section 12.6.

13.26 A symmetric dielectric slab waveguide has a slab thickness $d=10$ µm, with $n_{1}=1.48$ and

[Truncated for analysis]

## Core Ideas

- Group dispersion is measured by $d^2\beta/d\omega^2$.
- Dispersion depends strongly on the ratio $\omega_c/\omega$.
- The dispersion magnitude grows rapidly as operation approaches cutoff.
- A finite-bandwidth pulse broadens because its frequency components accumulate different group delays.
- The pulse example uses a 10 GHz center frequency and full width $2T=1.0\,\mathrm{ns}$.
- The operating frequency is specified as $1.1$ times the $\mathrm{TE}_{10}$ cutoff.
- Operating farther above cutoff reduces pulse broadening if the guide remains single mode.

## Source Anchors

- Problem 13.24 gives
$$
\frac{d^2\beta}{d\omega^2}=-\frac{n}{\omega c}\left(\frac{\omega_c}{\omega}\right)^2\left[1-\left(\frac{\omega_c}{\omega}\right)^2\right]^{-3/2}
$$
- The formula applies to a given mode in a parallel-plate or rectangular waveguide.
- Problem 13.25 specifies a transform-limited pulse with $f=10\,\mathrm{GHz}$ and $2T=1.0\,\mathrm{ns}$.
- The guide is lossless, air-filled, single mode, and operated at $1.1$ times the $\mathrm{TE}_{10}$ cutoff.

## Related Pages

- [[guided-mode-cutoff-and-single-mode-operation|Guided-Mode Cutoff and Single-Mode Operation]]
- [[waveguide-power-flow-and-field-structure|Waveguide Power Flow and Field Structure]]
- [[mode-confinement-and-mode-field-radius-in-step-index-fiber|Mode Confinement and Mode Field Radius in Step-Index Fiber]]

