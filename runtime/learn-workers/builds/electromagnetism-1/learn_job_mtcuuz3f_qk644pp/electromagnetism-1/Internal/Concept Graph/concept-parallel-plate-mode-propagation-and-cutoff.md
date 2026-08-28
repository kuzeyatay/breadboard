---
title: "Parallel-Plate Mode Propagation and Cutoff"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "parallel-plate-mode-propagation-and-cutoff"
locations: ["Page 484, Equation (40)", "Page 486, Equations (41) through (43)", "Page 487, Equation (44) and Example 13.1", "Page 490, Problems D13.6 and D13.7"]
related: ["transverse-resonance-and-mode-quantization", "counting-propagating-parallel-plate-modes", "below-cutoff-evanescent-fields", "phase-and-group-velocities-in-a-waveguide"]
---

## ConceptNode: Parallel-Plate Mode Propagation and Cutoff

Planning node for [[parallel-plate-mode-propagation-and-cutoff|1.272 Parallel-Plate Mode Propagation and Cutoff]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 484, Equation (40), Page 486, Equations (41) through (43), Page 487, Equation (44) and Example 13.1, Page 490, Problems D13.6 and D13.7

Substituting the quantized transverse constant into the wavevector relation produces the axial phase constant for mode $m$: $$\beta_m=\sqrt{k^2-\left(\frac{m\pi}{d}\right)^2}.$$ The radian cutoff frequency is defined by the point at which $\beta_m=0$: $$\omega_{cm}=\frac{m\pi c}{nd}.$$ Consequently, $$\beta_m=\frac{n\omega}{c}\sqrt{1-\left(\frac{\omega_{cm}}{\omega}\right)^2}.$$ If $\omega>\omega_{cm}$, then $\beta_m$ is real and the mode propagates. If $\omega<\omega_{cm}$, it is imaginary and the field is evanescent. The associated free-space cutoff wavelength is $$\lambda_{cm}=\frac{2nd}{m},$$ and propagation equivalently requires $\lambda<\lambda_{cm}$. For an air-filled guide, the first higher-order mode begins at $\lambda_{c1}=2d$. Since cutoff rises linearly with $m$, a frequency interval can be selected to permit TEM alone or TEM plus only specified higher-order modes.

### Key planning details

- The mode phase constant is $\beta_m=\sqrt{k^2-\kappa_m^2}$.
- The cutoff frequency is $\omega_{cm}=m\pi c/(nd)$.
- Propagation requires $\omega>\omega_{cm}$.
- Below cutoff, $\beta_m$ is imaginary and the mode is evanescent.
- The cutoff wavelength is $\lambda_{cm}=2nd/m$.
- Propagation in wavelength form requires $\lambda<\lambda_{cm}$.
- Higher mode order produces a higher cutoff frequency.
- The TEM mode remains available below the first higher-order cutoff.

### Source coverage

- Equation (40) expresses $\beta_m$ after inserting $\kappa_m=m\pi/d$.
- Equations (41) and (42) define $\omega_{cm}$ and express $\beta_m$ in normalized cutoff form.
- Equations (43) and (44) give the cutoff wavelength and wavelength-domain phase constant.
- Example 13.1 finds $f_{c1}=10.3\ \text{GHz}$ for $d=1\ \text{cm}$ and $\epsilon_r'=2.1$.
- Example 13.1 gives TEM-only operation below $10.3\ \text{GHz}$ and TEM plus $m=1$ TE and TM modes from $10.3$ to $20.6\ \text{GHz}$.
- Problem D13.6 gives a TEM-only maximum frequency of $20.7\ \text{GHz}$ for $d=5\ \text{mm}$ and $n=1.45$.
- Problem D13.7 gives $\lambda_{c2}=1\ \text{cm}$ for an air-filled guide with $d=1\ \text{cm}$.
