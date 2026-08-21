---
title: "1.337 Radiation Resistance and Current Distribution"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 565, Problems 14.7, 14.9, and 14.11", "Page 566, Problem 14.17", "Page 568, Problem 14.30"]
related: ["hertzian-dipole-field-regions-and-power-flow", "antenna-effective-area-and-directivity", "dipole-radiation-patterns-and-directivity"]
---

# 1.337 Radiation Resistance and Current Distribution

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 565, Problems 14.7, 14.9, and 14.11, Page 566, Problem 14.17, Page 568, Problem 14.30

Radiation resistance converts an antenna current description into an equivalent power relation, allowing radiated power to be treated as if it were dissipated by a resistance. The exercises emphasize that the result depends on the spatial current distribution, not only on the physical element length. Problem 14.7 compares uniform, linearly tapered, and stepped currents on the same short element with $d=0.03\lambda$. Problems 14.9 and 14.11 then use a linear current distribution to determine the peak current $I_0$ required either to produce a specified far-zone electric-field amplitude or to radiate a specified total power. The monopole problem adds a perfectly conducting ground plane, requiring the corresponding image-based radiation behavior. Problem 14.17 supplies a half-wave dipole radiation resistance of $73\ \Omega$, maximum directivity $1.64$, and current amplitude 1 A, then asks for total radiated power and power intercepted by a finite aperture. Problem 14.30 reverses the design relationship by asking for current amplitude in terms of radiated power, maximum effective area, and wavelength. Collectively, these tasks connect current profile, radiation resistance, total power, field strength, directivity, and effective area.

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

#### Page 568

radiates 100 W, how much power is dissipated by a matched load at the receiving antenna? (b) Suppose the receiving antenna is rotated by 45 deg while the two antennas remain in the same plane. What is the received power in this case?

14.30  $\boxed{b}$ A half-wave dipole antenna is known to have a maximum effective area, given as $A_{\max}$. (a) Write the maximum directivity of this antenna in terms of $A_{\max}$ and wavelength $\lambda$. (b) Express the current amplitude, $I_{0}$, needed to radiate total power, $P_{r}$, in terms of $P_{r}$, $A_{\max}$, and $\lambda$. (c) At what values of $\theta$ and $\phi$ will the antenna effective area be equal to $A_{\max}$?

## Core Ideas

- Radiation resistance depends on antenna geometry and current distribution.
- Uniform, linear, and stepped current profiles can produce different radiation resistances for the same length.
- A linear current distribution is zero at the dipole ends and peaks at the center.
- Current amplitude can be found from either a required far-zone field or a required total radiated power.
- A monopole above a perfect conductor differs from an isolated dipole because of the conducting plane.
- The half-wave dipole data include $R_{\mathrm{rad}}=73\ \Omega$ and $D_{\max}=1.64$.

## Source Anchors

- Problem 14.7 specifies $d=0.03\lambda$ and uniform, linear, and stepped current distributions.
- Problem 14.9 specifies a linear current distribution and $d=0.02\lambda$.
- Problem 14.11 specifies a $0.01\lambda$ monopole above a perfectly conducting plane.
- Problem 14.17 gives $R_{\mathrm{rad}}=73\ \Omega$, $D_{\max}=1.64$, and a 1-A current amplitude.
- Problem 14.30 asks for $I_0$ in terms of $P_r$, $A_{\max}$, and $\lambda$.

## Related Pages

- [[hertzian-dipole-field-regions-and-power-flow|Hertzian Dipole Field Regions and Power Flow]]
- [[antenna-effective-area-and-directivity|Antenna Effective Area and Directivity]]
- [[dipole-radiation-patterns-and-directivity|Dipole Radiation Patterns and Directivity]]

## Concept Dependencies

- related: [[antenna-effective-area-and-directivity|Antenna Effective Area and Directivity]]
