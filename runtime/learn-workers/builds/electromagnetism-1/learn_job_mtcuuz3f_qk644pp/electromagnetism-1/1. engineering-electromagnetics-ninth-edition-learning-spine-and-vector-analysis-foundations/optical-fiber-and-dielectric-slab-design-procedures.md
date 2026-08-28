---
title: "1.305 Optical Fiber and Dielectric Slab Design Procedures"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 525", "Page 526", "Figure 13.26", "Problems 13.26-13.32"]
related: ["mode-confinement-and-mode-field-radius-in-step-index-fiber", "guided-mode-cutoff-and-single-mode-operation"]
---

# 1.305 Optical Fiber and Dielectric Slab Design Procedures

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 525, Page 526, Figure 13.26, Problems 13.26-13.32

The dielectric-guide problems extend cutoff and modal analysis to symmetric and asymmetric slabs and to step-index optical fibers. In a symmetric slab, thickness, core index $n_1$, cladding index $n_2$, and free-space wavelength determine which TE and TM modes can propagate. Inverse problems use a single-mode requirement to bound the allowable core index or another design parameter. At modal cutoff, the phase velocity can be interpreted through the limiting propagation constant, and the same reasoning can be tested for higher-order modes. The asymmetric slab in Figure 13.26 has unequal exterior indices ordered as $n_1>n_3>n_2$. Its weakest total-internal-reflection boundary sets the minimum guided wave angle and therefore the maximum possible phase velocity. The fiber problems use the scaling of normalized frequency with core radius and wavelength to redesign the single-mode cutoff while retaining the same materials. They also reinforce that a single-mode field extends beyond the physical core, so the mode field radius is greater than the core radius. A measured mode radius and cutoff wavelength can be combined with wavelength-dependent normalized parameters to predict the radius at another wavelength.

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

#### Page 526

the minimum possible wave angle, $\theta_{1}$, that a guided mode may have.

$(b)$ Write an expression for the maximum phase velocity a guided mode may have in this structure, using given or known parameters.

13.30

A step index optical fiber is known to be single mode at wavelengths $\lambda>1.2\,\mu\mathrm{m}$. Another fiber is to be fabricated from the same materials, but it is to be single mode at wavelengths $\lambda>0.63\,\mu\mathrm{m}$. By what percentage must the core radius of the new fiber differ from the old one, and should it be larger or smaller?

13.31

Is the mode field radius greater than or less than the fiber core radius in single-mode step index fiber?

13.32

The mode field radius of a step index fiber is measured as $4.5\,\mu\mathrm{m}$ at free-space wavelength $\lambda=1.30\,\mu\mathrm{m}$. If the cutoff wavelength is specified as $\lambda_{c}=1.20\,\mu\mathrm{m}$, find the expected mode field radius at $\lambda=1.55\,\mu\mathrm{m}$.

## Core Ideas

- Slab mode content is determined by thickness, refractive-index contrast, and wavelength.
- A single-mode requirement can place an upper bound on the slab core index.
- Modal phase velocity at cutoff follows from the cutoff value of the propagation constant.
- In an asymmetric slab, the lower-confinement interface limits the guided wave angle.
- The maximum guided-mode phase velocity follows from the minimum allowed wave angle.
- For fixed fiber materials, single-mode cutoff wavelength scales with core radius.
- The mode field radius of a single-mode step-index fiber exceeds the physical core radius.
- Mode field radius measurements at one wavelength can support prediction at another wavelength.

## Source Anchors

- Problem 13.26 specifies a symmetric slab with $d=10\,\mu\mathrm{m}$, $n_1=1.48$, $n_2=1.45$, and $\lambda=1.3\,\mu\mathrm{m}$.
- Problem 13.27 asks for the maximum $n_1$ compatible with one TE/TM mode pair at $\lambda=1.55\,\mu\mathrm{m}$ when $d=5\,\mu\mathrm{m}$ and $n_2=3.30$.
- Figure 13.26 and Problem 13.29 define an asymmetric slab with $n_1>n_3>n_2$.
- Problem 13.30 compares fibers made from the same materials with single-mode thresholds of $1.2\,\mu\mathrm{m}$ and $0.63\,\mu\mathrm{m}$.
- Problem 13.32 gives a measured mode field radius of $4.5\,\mu\mathrm{m}$ at $1.30\,\mu\mathrm{m}$ and cutoff wavelength $1.20\,\mu\mathrm{m}$.

## Related Pages

- [[mode-confinement-and-mode-field-radius-in-step-index-fiber|Mode Confinement and Mode Field Radius in Step-Index Fiber]]
- [[guided-mode-cutoff-and-single-mode-operation|Guided-Mode Cutoff and Single-Mode Operation]]

## Concept Dependencies

- applies-to: [[guided-mode-cutoff-and-single-mode-operation|Guided-Mode Cutoff and Single-Mode Operation]]
