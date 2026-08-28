---
title: "1.338 Dipole Radiation Patterns and Directivity"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 565, Problems 14.10, 14.12, and 14.14", "Pages 565-566, Problems 14.15-14.16"]
related: ["hertzian-dipole-field-regions-and-power-flow", "radiation-resistance-and-current-distribution", "linear-antenna-array-factor-and-beam-steering", "antenna-effective-area-and-directivity"]
---

# 1.338 Dipole Radiation Patterns and Directivity

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 565, Problems 14.10, 14.12, and 14.14, Pages 565-566, Problems 14.15-14.16

The radiation pattern problems treat the dipole's $E$-plane pattern as a quantitative design object. Students must identify zeros, maxima, half-power beamwidth, sidelobe peak locations, sidelobe intensity, and maximum directivity as the electrical length changes. A geometric result connects the chord length in the pattern construction to $b\sin\theta$, where $b$ is the circle diameter. Figure 14.8 is explicitly used as a guide for locating zeros and sidelobes of longer dipoles, making it a source-central visual opportunity for comparing patterns as $2\ell/\lambda$ changes. The sidelobe level is defined through the ratio of main-lobe to sidelobe power density,
$$
S_s[\mathrm{dB}]=10\log_{10}\left(\frac{S_{r,\mathrm{main}}}{S_{r,\mathrm{sidelobe}}}\right)
$$
 Problems progress from a full-wave dipole to lengths $1.3\lambda$ and $1.5\lambda$, where additional lobes and nulls appear. The half-wave and full-wave link problems then connect the directional pattern to intercepted power. This concept belongs after the basic dipole field and before arrays, because an array pattern builds on the directional response of each individual element.

## Page-Grounded Details

#### Page 565

to a current element of differential length $d$, oriented along the $z$ axis, and centered at the origin.

$\underline{14.6}$ Evaluate the time-average Poynting vector, $<S>=\left(\frac{1}{2}\right)\mathcal{R}e\left\{E_{s}\times H_{s}^{*}\right\}$ for the Hertzian dipole, assuming the general case that involves the field components as given by Eqs. (10), (13$a$), and (13$b$). Compare your result to the far-zone case, Eq. (26).

$\underline{14.7}$ A short current element has $d=0.03\lambda$. Calculate the radiation resistance that is obtained for each of the following current distributions: ($a$) uniform, $I_{0}$; ($b$) linear, $I(z)=I_{0}(0.5d-|z|)/0.5d$; ($c$) step, $I_{0}$ for $0<|z|<0.25d$ and $0.5I_{0}$ for $0.25d<|z|<0.5d$.

$\underline{14.8}$ Evaluate the time-average Poynting vector, $<S>=(1/2)\mathcal{R}e\left\{E_{s}\times H_{s}^{*}\right\}$ for the magnetic dipole antenna in the far zone, in which all terms of order $1/r^{2}$ and $1/r^{4}$ are neglected in Eqs. (48), (49), and (50). Compare your result to the far-zone power density of the Hertzian dipole, Eq. (26). In this comparison, and assuming equal current amplitudes, what rel

[Truncated for analysis]

#### Page 566

main lobe intensity. Express your result as the sidelobe level in decibels, given by$S_{s}$ [dB]= 10 $\log_{10}(S_{r,\text{main}}/S_{r,\text{sidelobe}})$. Again, use Figure 14.8 as a guide.

14.16 For a dipole antenna of overall length, $2\ell=1.5\lambda$, (a) evaluate the locations in $\theta$ at which the zeros and maxima in the $E$-plane pattern occur; (b) determine the sidelobe level, as per the definition in Problem 14.14; (c) determine the maximum directivity.

14.17 Consider a lossless half-wave dipole in free space, with radiation resistance, $R_{\text{rad}}=73$ ohms, and maximum directivity $D_{\text{max}}=1.64$. If the antenna carries a 1-A current amplitude, (a) how much total power (in watts) is radiated? (b) How much power is intercepted by a $1-m^{2}$ aperture situated at distance $r=1$ km away? The aperture is on the equatorial plane and squarely faces the antenna. Assume uniform power density over the aperture.

14.18 Repeat Problem 14.17, but with a full-wave antenna ($2\ell=\lambda$). Numerical integrals may be necessary.

14.19 Design a two-element dipole array that will radiate equal intensities in the $\phi=0$, $\pi/2$, $\pi$, and $ 3\

[Truncated for analysis]

## Core Ideas

- Pattern zeros identify directions of no radiation.
- Half-power beamwidth measures the angular width between half-power points around the main maximum.
- Longer dipoles can develop sidelobes and additional nulls.
- Sidelobe level is $10\log_{10}(S_{r,\mathrm{main}}/S_{r,\mathrm{sidelobe}})$.
- Maximum directivity summarizes the strongest directional concentration.
- Figure 14.8 is used to guide the analysis of zeros and sidelobes.

## Source Anchors

- Problem 14.10 asks to show that the Figure 14.4 chord length equals $b\sin\theta$.
- Problem 14.12 asks for pattern zeros for $\ell=\lambda$ and $2\ell=1.3\lambda$, using Figure 14.8.
- Problem 14.14 asks for maximum directivity in decibels and half-power beamwidth for $2\ell=\lambda$.
- Problem 14.15 defines sidelobe level and asks for sidelobe positions and peak intensity for $2\ell=1.3\lambda$.
- Problem 14.16 asks for zeros, maxima, sidelobe level, and maximum directivity for $2\ell=1.5\lambda$.

## Related Pages

- [[hertzian-dipole-field-regions-and-power-flow|Hertzian Dipole Field Regions and Power Flow]]
- [[radiation-resistance-and-current-distribution|Radiation Resistance and Current Distribution]]
- [[linear-antenna-array-factor-and-beam-steering|Linear Antenna Array Factor and Beam Steering]]
- [[antenna-effective-area-and-directivity|Antenna Effective Area and Directivity]]

## Concept Dependencies

- enables: [[antenna-effective-area-and-directivity|Antenna Effective Area and Directivity]]
