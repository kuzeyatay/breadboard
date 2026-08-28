---
title: "1.273 Counting Propagating Parallel-Plate Modes"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 487, Example 13.2"]
related: ["parallel-plate-mode-propagation-and-cutoff", "te-and-tm-polarization-in-parallel-plate-guides"]
---

# 1.273 Counting Propagating Parallel-Plate Modes

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 487, Example 13.2

The cutoff-wavelength condition provides a direct procedure for counting the modes supported at a given operating wavelength. A mode of order $m$ propagates when
$$
\lambda<\lambda_{cm}=\frac{2nd}{m}
$$
 Rearranging gives an upper bound on the integer mode number:
$$
m<\frac{2nd}{\lambda}
$$
 Every positive integer satisfying this strict inequality identifies one permitted order. In the parallel-plate guide, each positive order has both a TE and a TM mode, so the number of non-TEM guided modes is twice the number of permitted positive orders. The TEM mode, which has no cutoff, is counted separately. Example 13.2 applies the method to the Teflon-filled guide with $n=\sqrt{2.1}$, $d=10\ \text{mm}$, and $\lambda=2\ \text{mm}$. The bound is $m<14.5$, so orders $m=1$ through $14$ propagate. This produces 28 above-cutoff TE and TM modes, excluding TEM.

## Page-Grounded Details

#### Page 487

Note, for example, that in an air-filled guide (n = 1) the wavelength at which the lowest-order mode first starts to propagate is $\lambda_{c1}=2d$, or the plate separation is one-half wavelength. Mode m will propagate whenever $\omega>\omega_{cm}$, or equivalently whenever $\lambda<\lambda_{cm}$. Use of the cutoff wavelength enables us to construct a second useful form of Eq. (42):
$$
\beta_{m}=\frac{2\pi n}{\lambda}\sqrt{1-(\frac{\lambda}{\lambda_{cm}})^{2}}\quad{(44)}
$$
#### Example 13.1

A parallel-plate waveguide has plate separation d = 1 cm and is filled with Teflon having dielectric constant $\epsilon_{r}^{\prime}=2.1$. Determine the maximum operating frequency such that only the TEM mode will propagate. Also find the range of frequencies over which the TE_1 and TM_1 (m = 1) modes, and no higher-order modes, will propagate.

Solution. Using (41), the cutoff frequency for the first waveguide mode (m = 1) will be
$$
f_{c1}=\frac{\omega_{c1}}{2\pi}=\frac{2.99\times 10^{10}}{2\sqrt{2.1}}=1.03\times 10^{10}\,\text{Hz}=10.3\,\text{GHz}
$$
To propagate only TEM waves, we must have f < 10.3 GHz. To allow TE_1 and TM_1 (along with TEM) only, the frequency range must be

[Truncated for analysis]

## Core Ideas

- Start from the condition $\lambda<2nd/m$.
- Rearrange to obtain $m<2nd/\lambda$.
- Retain only positive integer mode orders satisfying the strict inequality.
- Each positive order supplies one TE mode and one TM mode.
- The TEM mode is excluded from the TE and TM count.
- For the example, $m<14.5$ means the highest propagating order is $m=14$.
- The example therefore has 28 non-TEM propagating modes.

## Source Anchors

- Example 13.2 uses the guide from Example 13.1 and an operating wavelength of $2\ \text{mm}$.
- The inequality becomes $2\ \text{mm}<2\sqrt{2.1}(10\ \text{mm})/m$.
- The resulting bound is $m<14.5$.
- The source concludes that modes through $m=14$ propagate.
- With TE and TM modes for each order, the source reports 28 guided modes excluding TEM.

## Related Pages

- [[parallel-plate-mode-propagation-and-cutoff|Parallel-Plate Mode Propagation and Cutoff]]
- [[te-and-tm-polarization-in-parallel-plate-guides|TE and TM Polarization in Parallel-Plate Guides]]

## Concept Dependencies

- depends-on: [[te-and-tm-polarization-in-parallel-plate-guides|TE and TM Polarization in Parallel-Plate Guides]]
