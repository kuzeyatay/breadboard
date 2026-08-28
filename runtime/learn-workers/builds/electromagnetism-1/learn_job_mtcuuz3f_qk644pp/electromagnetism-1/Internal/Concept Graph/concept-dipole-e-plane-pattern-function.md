---
title: "Dipole E-Plane Pattern Function"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "dipole-e-plane-pattern-function"
locations: ["Page 544", "Page 545", "Section 14.4.3", "Figure 14.8"]
related: ["parity-based-evaluation-of-the-dipole-field-integral", "radiation-intensity-directivity-and-radiation-resistance", "half-wave-dipole-pattern-and-performance", "pattern-multiplication-for-antenna-arrays"]
---

## ConceptNode: Dipole E-Plane Pattern Function

Planning node for [[dipole-e-plane-pattern-function|1.320 Dipole E-Plane Pattern Function]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 544, Page 545, Section 14.4.3, Figure 14.8

The angular dependence of a finite dipole is isolated in the pattern function $F(\theta)=[\cos(k\ell\cos\theta)-\cos(k\ell)]/\sin\theta$. When normalized to its maximum magnitude, this function gives the dipole's E-plane field pattern. Because a single straight dipole is rotationally symmetric about the $z$ axis, any plane containing that axis has the same pattern. The pattern changes systematically with overall length $2\ell$. Very short dipoles produce a nearly circular E-plane polar curve corresponding to the familiar Hertzian-dipole behavior. Increasing the length initially narrows the main beam, improving angular concentration. Once the overall length exceeds approximately one wavelength, secondary maxima or sidelobes develop. These sidelobes divert power away from the intended main-beam direction and their directions vary with wavelength. A broadband signal can consequently acquire an angular spread because its different frequency components have different sidelobe directions. The source therefore identifies lengths below one wavelength as a practical way to avoid these effects while retaining a single dominant broadside lobe.

### Key planning details

- The dipole pattern function is $F(\theta)=[\cos(k\ell\cos\theta)-\cos(k\ell)]/\sin\theta$.
- The normalized magnitude of $F(\theta)$ is the E-plane field pattern.
- All planes containing the dipole axis have the same pattern.
- Very short dipoles approximate the Hertzian-dipole pattern.
- Increasing dipole length initially narrows the main beam.
- Overall lengths greater than one wavelength develop sidelobes.
- Sidelobes send power away from the intended direction and move with wavelength.
- Using a length below one wavelength avoids the cited sidelobe and angular-spread problems.

### Source coverage

- Equation (59), Page 544 defines $F(\theta)=[\cos(k\ell\cos\theta)-\cos(k\ell)]/\sin\theta$.
- Figure S26.P545.F14.8 compares normalized E-plane patterns for overall lengths $\lambda/16$, $\lambda/2$, $\lambda$, $1.3\lambda$, and $2\lambda$.
- The $\lambda/16$ curve is described as nearly circular and approximating the Hertzian-dipole pattern.
- The source reports sidelobe development for overall lengths exceeding one wavelength.
- For the $2\lambda$ antenna, Figure 14.8 shows four symmetrically arranged main lobes, with the first-quadrant lobe at approximately $57.5^\circ$.
- Page 545 explains that wavelength-dependent sidelobe directions can produce angular spread in broadband signals.
