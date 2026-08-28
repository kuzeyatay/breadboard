---
title: "1.293 Slab Transverse Resonance and Single-Mode Cutoff"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 511, Section 13.6.4 and Eqs. (139)-(143)", "Page 511, single-mode slab example", "Page 512, Problem D13.11"]
related: ["piecewise-slab-mode-fields-and-frequency-dependent-confinement", "symmetric-dielectric-slab-waveguide-and-total-internal-reflection", "fiber-eigenvalue-equation-and-normalized-frequency", "single-mode-step-index-fiber"]
---

# 1.293 Slab Transverse Resonance and Single-Mode Cutoff

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 511, Section 13.6.4 and Eqs. (139)-(143), Page 511, single-mode slab example, Page 512, Problem D13.11

Allowed slab modes must reproduce their phase after a transverse round trip through the core and two total reflections. For TE waves the round-trip phase is $2\kappa_1d+2\phi_{TE}$, and for TM waves it is $2\kappa_1d+2\phi_{TM}$. Setting either expression equal to $2m\pi$ gives the slab eigenvalue equations. Because both the transverse wavenumber and reflection phase depend differently on $\theta_1$, these equations are transcendental and require numerical or graphical solution. Their cutoff consequence is simpler: mode m propagates when $k_0d\sqrt{n_1^2-n_2^2}\geq(m-1)\pi$. The integer m counts transverse half-cycles of electric field for TE modes or magnetic field for TM modes. The lowest mode, $m=1$, has no cutoff. Suppressing the $m=2$ modes gives the single-mode-pair condition $k_0d\sqrt{n_1^2-n_2^2}<\pi$, equivalently $\lambda>2d\sqrt{n_1^2-n_2^2}$. The worked optical example uses this inequality to constrain the slab refractive index.

## Page-Grounded Details

#### Page 511

the transverse round trip analysis in the slab region in the same manner that was done in Section 13.3 and obtain an equation similar to (37):
$$
\kappa_{1} d + \phi_{TE} + \kappa_{1} d + \phi_{TE} = 2 m \pi \qquad(139)
$$
for TE waves and
$$
\kappa_{1} d + \phi_{TM} + \kappa_{1} d + \phi_{TM} = 2 m \pi \qquad(140)
$$
for the TM case. Eqs. (139) and (140) are called the eigenvalue equations for the symmetric dielectric slab waveguide. The phase shifts on reflection, $\phi_{TE}$ and $\phi_{TM}$, are the phases of the reflection coefficients, $\Gamma_{s}$ and $\Gamma_{p}$, given in (119) and (120). These are readily found, but they turn out to be functions of $\theta_{1}$. As we know, $\kappa_{1}$ also depends on $\theta_{1}$, but in a different way than $\phi_{TE}$ and $\phi_{TM}$. Consequently, (139) and (140) are transcendental in $\theta_{1}$, and they cannot be solved in closed form. Instead, numerical or graphical methods must be used (see References 4 or 5). Emerging from this solution process, however, is a fairly simple cutoff condition for any TE or TM mode:
$$
k_{0} d \sqrt{n_{1}^{2} - n_{2}^{2}} \geq (m - 1) \pi \qquad(m = 1, 2, 3, \ldots) \qquad(

[Truncated for analysis]

#### Page 512

Clearly, fabrication tolerances are very exacting when constructing dielectric guides for single-mode operation!

D13.11 A 0.5-mm-thick slab of glass ($n_{1}=1.45$) is surrounded by air ($n_{2}=1$). The slab waveguides infrared light at wavelength $\lambda=1.0\,\mu$m. How many TE and TM modes will propagate?

Ans. 2102

#### 13.7 OPTICAL FIBER

Optical fiber works on the same principle as the dielectric slab waveguide, except of course for the round cross section. A _step index_ fiber is shown in Figure 13.10, in which a high-index $\mathit{core}$ of radius $a$ is surrounded by a lower-index $\mathit{cladding}$ of radius $b$. Light is confined to the core through the mechanism of total reflection, but again some frac-tion of the power resides in the cladding as well. As we found in the slab waveguide, the cladding power again moves in toward the core as frequency is raised. Additionally, as is true in the slab waveguide, the fiber supports a mode that has no cutoff.

Analysis of the optical fiber is complicated. This is mainly because of the round cross section, along with the fact that it is generally a three-dimensional problem; the slab waveguide had only two dimen

[Truncated for analysis]

## Core Ideas

- A transverse round trip must accumulate an integer multiple of $2\pi$ phase.
- TE and TM eigenvalue equations differ through their reflection phases.
- The eigenvalue equations are transcendental in the internal wave angle.
- Mode m propagates when $k_0d\sqrt{n_1^2-n_2^2}\geq(m-1)\pi$.
- The mode number counts transverse field half-cycles.
- The $m=1$ TE and TM modes have no cutoff.
- Single-mode-pair operation requires the $m=2$ modes to remain below cutoff.
- The wavelength condition is $\lambda>2d\sqrt{n_1^2-n_2^2}$.

## Source Anchors

- Equation (139):
$$
2\kappa_1d+2\phi_{TE}=2m\pi.
$$
- Equation (140):
$$
2\kappa_1d+2\phi_{TM}=2m\pi.
$$
- Equation (141):
$$
k_0d\sqrt{n_1^2-n_2^2}\geq(m-1)\pi.
$$
- Equation (142):
$$
k_0d\sqrt{n_1^2-n_2^2}<\pi.
$$
- Equation (143):
$$
\lambda>2d\sqrt{n_1^2-n_2^2}.$$
- For $\lambda=1.30\,\mu\mathrm{m}$, $d=5.00\,\mu\mathrm{m}$, and $n_2=1.450$, the source obtains $n_1<1.456$.
- Problem D13.11 states that a 0.5 mm glass slab with $n_1=1.45$, air cladding, and $\lambda=1.0\,\mu$m supports 2102 TE and TM modes.

## Related Pages

- [[piecewise-slab-mode-fields-and-frequency-dependent-confinement|Piecewise Slab Mode Fields and Frequency-Dependent Confinement]]
- [[symmetric-dielectric-slab-waveguide-and-total-internal-reflection|Symmetric Dielectric Slab Waveguide and Total Internal Reflection]]
- [[fiber-eigenvalue-equation-and-normalized-frequency|Fiber Eigenvalue Equation and Normalized Frequency]]
- [[single-mode-step-index-fiber|Single-Mode Step-Index Fiber]]

## Concept Dependencies

- depends-on: [[symmetric-dielectric-slab-waveguide-and-total-internal-reflection|Symmetric Dielectric Slab Waveguide and Total Internal Reflection]]
- related: [[single-mode-step-index-fiber|Single-Mode Step-Index Fiber]]
