---
title: "1.302 Guided-Mode Cutoff and Single-Mode Operation"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 523", "Page 524", "Figure 13.25", "Problems 13.11-13.21"]
related: ["transmission-line-parameter-and-impedance-design-procedures", "waveguide-power-flow-and-field-structure", "waveguide-dispersion-and-pulse-broadening", "optical-fiber-and-dielectric-slab-design-procedures"]
---

# 1.302 Guided-Mode Cutoff and Single-Mode Operation

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 523, Page 524, Figure 13.25, Problems 13.11-13.21

Cutoff separates propagating modes from evanescent modes in parallel-plate and rectangular waveguides. The problem set develops a consistent method: determine each mode's cutoff frequency or cutoff wavelength from guide dimensions and material properties, compare the operating frequency with those thresholds, and count or identify the modes that satisfy the propagation condition. For a parallel-plate guide intended to carry only TEM over a stated band, the plate spacing must be small enough that the first TE and TM cutoff remains above the maximum operating frequency. Conversely, a known cutoff can be used to infer plate separation or dielectric constant. Rectangular-guide design requires ordering the cutoff frequencies of $\mathrm{TE}_{mn}$ and $\mathrm{TM}_{mn}$ modes, then placing the operating band above the dominant-mode cutoff and below the next available cutoff. Problems involving joined air-filled and dielectric-filled guides add a simultaneous constraint: the same frequency must lie in the single-mode interval of both regions. The dielectric interfaces in a partially filled parallel-plate guide also connect modal propagation to oblique-wave ideas, including Brewster transmission and total internal reflection at the critical angle.

## Page-Grounded Details

#### Page 523

Figure 13.25 See Problems 13.17 and 13.18.

13.10 $\downarrow$ Two microstrip lines are fabricated end-to-end on a 2-mm-thick wafer of lithium niobate ($\epsilon_{r}^{\prime}=4.8$). Line 1 is of 4 mm width; line 2 (unfortunately) has been fabricated with a 5 mm width. Determine the power loss in dB for waves transmitted through the junction.

13.11 $\downarrow$ A parallel-plate waveguide is known to have a cutoff wavelength for the $m=1$ TE and TM modes of $\lambda_{c1}=4.1$ mm. The guide is operated at wavelength $\lambda=1.0$ mm. How many modes propagate?

13.12 $\downarrow$ A parallel-plate guide is to be constructed for operation in the TEM mode only over the frequency range $0<f<3$ GHz. The dielectric between plates is to be Teflon ($\epsilon_{r}^{\prime}=2.1$). Determine the maximum allowable plate separation, $d$.

13.13 $\downarrow$ A lossless parallel-plate waveguide is known to propagate the $m=2$ TE and TM modes at frequencies as low as 10 GHz. If the plate separation is 1 cm, determine the dielectric constant of the medium between plates.

13.14 $\downarrow$ A $d=1$ cm parallel-plate guide is made with glass ($n=1.45$) between plates. If th

[Truncated for analysis]

#### Page 524

frequencies over which this will occur. (b) Does your part a answer in any way relate to the cutoff frequency for m = 1 modes in either region? Hint: Remember the critical angle?

13.19

A rectangular waveguide has dimensions a = 6 cm and b = 4 cm. (a) Over what range of frequencies will the guide operate single mode? (b) Over what frequency range will the guide support both TE_10 and TE_01 modes and no others?

13.20

Two rectangular waveguides are joined end-to-end. The guides have identical dimensions, where a = 2b. One guide is air-filled; the other is filled with a lossless dielectric characterized by $e_{r}^{\prime}$. (a) Determine the maximum allowable value of $e_{r}^{\prime}$ such that single-mode operation can be simultaneously assured in both guides at some frequency. (b) Write an expression for the frequency range over which single-mode operation will occur in both guides; your answer should be in terms of $e_{r}^{\prime}$, guide dimensions as needed, and other known constants.

13.21

An air-filled rectangular waveguide is to be constructed for single-mode operation at 15 GHz. Specify the guide dimensions, a and b, such that the design frequency is 10 percent hig

[Truncated for analysis]

## Core Ideas

- A mode propagates only when the operating frequency exceeds its cutoff frequency.
- TEM operation alone requires suppressing the first higher-order TE and TM modes.
- Mode counting follows from comparing the operating frequency with all relevant modal cutoffs.
- Guide dimensions and dielectric constant can be inferred from measured cutoff information.
- Rectangular-waveguide single-mode operation lies between the dominant-mode cutoff and the next-lowest cutoff.
- Joined guides require an overlap between the single-mode frequency intervals of both regions.
- Brewster-angle matching can eliminate reflection for a TM mode at a dielectric interface.
- Critical-angle behavior can cause total modal reflection at a dielectric interface.

## Source Anchors

- Problems 13.11 through 13.16 address mode counting, TEM-only design, dielectric inference, propagating-mode identification, group delay, and group velocity in parallel-plate guides.
- Figure 13.25 supports Problems 13.17 and 13.18, which use a guide partially filled with dielectrics having $\epsilon'_{r1}=4.0$ and $\epsilon'_{r2}=2.1$.
- Problem 13.17 explicitly invokes Brewster's angle for reflectionless $\mathrm{TM}_1$ transmission.
- Problem 13.18 invokes the critical angle to determine a total-reflection frequency range.
- Problems 13.19 through 13.21 require rectangular-waveguide single-mode bands and dimensional design.

## Related Pages

- [[transmission-line-parameter-and-impedance-design-procedures|Transmission-Line Parameter and Impedance Design Procedures]]
- [[waveguide-power-flow-and-field-structure|Waveguide Power Flow and Field Structure]]
- [[waveguide-dispersion-and-pulse-broadening|Waveguide Dispersion and Pulse Broadening]]
- [[optical-fiber-and-dielectric-slab-design-procedures|Optical Fiber and Dielectric Slab Design Procedures]]

## Concept Dependencies

- enables: [[waveguide-power-flow-and-field-structure|Waveguide Power Flow and Field Structure]]
- causes: [[waveguide-dispersion-and-pulse-broadening|Waveguide Dispersion and Pulse Broadening]]
