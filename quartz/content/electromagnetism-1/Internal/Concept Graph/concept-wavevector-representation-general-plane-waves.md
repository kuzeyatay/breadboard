---
title: "Wavevector Representation of General Plane Waves"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "wavevector-representation-general-plane-waves"
locations: ["Page 440", "Page 441", "Page 442", "Page 443", "Section 12.4: Plane Wave Propagation in General Directions", "Example 12.6", "Exercise D12.4"]
related: ["refractive-index-material-wave-parameters", "oblique-incidence-geometry-polarization", "phase-matching-reflection-law-snells-law", "frequency-dependent-refractive-index-angular-dispersion"]
---

## ConceptNode: Wavevector Representation of General Plane Waves

Planning node for [[wavevector-representation-general-plane-waves|1.259 Wavevector Representation of General Plane Waves]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 440, Page 441, Page 442, Page 443, Section 12.4: Plane Wave Propagation in General Directions, Example 12.6, Exercise D12.4

A plane wave propagating in an arbitrary direction is described by a wavevector $\mathbf{k}$ whose direction is the propagation direction and whose magnitude is the phase shift per unit distance along that direction. In an isotropic lossless medium, this direction also agrees with the Poynting-vector direction. The phase at position $\mathbf{r}$ is measured by the dot product $\mathbf{k}\cdot\mathbf{r}$, giving the phasor $\mathbf{E}_s=\mathbf{E}_0e^{-j\mathbf{k}\cdot\mathbf{r}}$. In two dimensions, with $\mathbf{k}=k_x\mathbf{a}_x+k_z\mathbf{a}_z$ and $\mathbf{r}=x\mathbf{a}_x+z\mathbf{a}_z$, the phase is $k_xx+k_zz$. The propagation angle from the $x$ axis is $\tan^{-1}(k_z/k_x)$. Wavelength and phase velocity along $\mathbf{k}$ use the vector magnitude $k=\sqrt{k_x^2+k_z^2}$, whereas apparent values measured along a coordinate axis use only the associated component. These axial phase velocities can exceed the medium's light speed without violating relativity because they describe moving intersections of phase fronts, not energy transport. Example 12.6 demonstrates construction of a field phasor from frequency, permittivity, direction, and polarization.

### Key planning details

- The general plane-wave phasor is $\mathbf{E}_s=\mathbf{E}_0e^{-j\mathbf{k}\cdot\mathbf{r}}$.
- The direction of $\mathbf{k}$ is the propagation and power-flow direction in the stated isotropic medium.
- In two dimensions, $\mathbf{k}\cdot\mathbf{r}=k_xx+k_zz$.
- The propagation angle is $\theta=\tan^{-1}(k_z/k_x)$.
- Along $\mathbf{k}$, $\lambda=2\pi/k$ and $v_p=\omega/k$.
- Along $x$, $\lambda_x=2\pi/k_x$ and $v_{px}=\omega/k_x$.
- Frequency remains invariant with direction: $f=v_p/\lambda=v_{px}/\lambda_x$.

### Source coverage

- Figure S1.P441.F1, corresponding to Figure 12.6, shows $\mathbf{k}$, $\mathbf{r}$, constant-phase planes, $\lambda$, and the larger axial phase-front spacing.
- Equation (49) gives $$\mathbf{E}_s=\mathbf{E}_0e^{-j\mathbf{k}\cdot\mathbf{r}}.$$
- Equation (50) gives $$\mathbf{E}_s=\mathbf{E}_0e^{-j(k_xx+k_zz)}.$$
- Pages 442 and 443 explain why axial phase velocity may exceed the medium light speed without carrying energy in that direction.
- Example 12.6 obtains $\mathbf{k}=2.8\mathbf{a}_x+1.6\mathbf{a}_y\ \mathrm{m}^{-1}$ for a 50 MHz wave in a medium with $\epsilon_r=9$.
- The example's field is $\mathbf{E}_s=10e^{-j(2.8x+1.6y)}\mathbf{a}_z$ V/m.
- Exercise D12.4 gives $\lambda_x=2.2$ m, $\lambda_y=3.9$ m, $v_{px}=1.1\times10^8$ m/s, and $v_{py}=2.0\times10^8$ m/s.
