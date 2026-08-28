---
title: "1.301 Transmission-Line Parameter and Impedance Design Procedures"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 522", "Page 523", "Problems 13.1-13.10"]
related: ["guided-mode-cutoff-and-single-mode-operation", "waveguide-power-flow-and-field-structure"]
---

# 1.301 Transmission-Line Parameter and Impedance Design Procedures

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 522, Page 523, Problems 13.1-13.10

The transmission-line problems organize a reusable design procedure around the distributed parameters $R$, $L$, $C$, and $G$, together with characteristic impedance and phase velocity. For coaxial, two-wire, planar, and microstrip structures, geometry and material properties determine the electric and magnetic energy storage, dielectric leakage, and conductor loss per unit length. The problems require both forward analysis, where dimensions and material constants are used to calculate line parameters, and inverse design, where a required $Z_0$, capacitance, inductance, or phase velocity determines a missing radius, spacing, or dielectric constant. At high frequency, conductor conductivity and permeability enter through skin effect, while dielectric loss may be represented by conductivity or the ratio $\sigma/(\omega\epsilon')$. Several tasks expose engineering tradeoffs rather than asking for a single parameter. In an air-filled coaxial line, the radius ratio that minimizes skin-effect attenuation differs from the ratio that maximizes power handling before breakdown. Microstrip problems use width-to-substrate-thickness ratio and effective relative permittivity, while a junction between unequal microstrip widths becomes an impedance discontinuity whose transmitted power can be evaluated from reflection and transmission behavior.

## Page-Grounded Details

#### Page 522

### CHAPTER 13 PROBLEMS

13.1 The conductors of a coaxial transmission line are copper ($\sigma_{c}=5.8\times10^{7}S/m$), and the dielectric is polyethylene ($\epsilon_{r}^{\prime}=2.26$, $\sigma/\omega\epsilon^{\prime}=0.0002$). If the inner radius of the outer conductor is 4 mm, find the radius of the inner conductor so that (a) $Z_{0}=50\Omega$; (b) C = 100 pF/m; (c) L = 0.2 $\mu$H/m. A lossless line can be assumed.

13.2 Find R, L, C, and G for a coaxial cable with a = 0.25 mm, b = 2.50 mm, c = 3.30 mm, $\epsilon_{r}=2.0$, $\mu_{r}=1$, $\sigma_{c}=1.0\times10^{7}S/m$, $\sigma=1.0\times10^{-5}S/m$, and f = 300 MHz.

13.3 Two aluminum-clad steel conductors are used to construct a two-wire transmission line. Let $\sigma_{Al}=3.8\times10^{7}S/m$, $\sigma_{St}=5\times10^{6}S/m$, and $\mu_{St}=100\mu H/m$. The radius of the steel wire is 0.5 in., and the aluminum coating is 0.05 in. thick. The dielectric is air, and the center-to-center wire separation is 4 in. Find C, L, G, and R for the line at 10 MHz.

13.4 Find R, L, C, and G for a two-wire transmission line in polyethylene at f = 800 MHz. Assume copper conductors of radius 0.50 mm and separation 0.80 cm.

[Truncated for analysis]

#### Page 523

Figure 13.25 See Problems 13.17 and 13.18.

13.10 $\downarrow$ Two microstrip lines are fabricated end-to-end on a 2-mm-thick wafer of lithium niobate ($\epsilon_{r}^{\prime}=4.8$). Line 1 is of 4 mm width; line 2 (unfortunately) has been fabricated with a 5 mm width. Determine the power loss in dB for waves transmitted through the junction.

13.11 $\downarrow$ A parallel-plate waveguide is known to have a cutoff wavelength for the $m=1$ TE and TM modes of $\lambda_{c1}=4.1$ mm. The guide is operated at wavelength $\lambda=1.0$ mm. How many modes propagate?

13.12 $\downarrow$ A parallel-plate guide is to be constructed for operation in the TEM mode only over the frequency range $0<f<3$ GHz. The dielectric between plates is to be Teflon ($\epsilon_{r}^{\prime}=2.1$). Determine the maximum allowable plate separation, $d$.

13.13 $\downarrow$ A lossless parallel-plate waveguide is known to propagate the $m=2$ TE and TM modes at frequencies as low as 10 GHz. If the plate separation is 1 cm, determine the dielectric constant of the medium between plates.

13.14 $\downarrow$ A $d=1$ cm parallel-plate guide is made with glass ($n=1.45$) between plates. If th

[Truncated for analysis]

## Core Ideas

- Distributed parameters $R$, $L$, $C$, and $G$ depend on conductor geometry, conductivity, permeability, and dielectric properties.
- Inverse line design can solve for geometry from $Z_0$, $C$, $L$, or phase velocity.
- Skin effect must be included in high-frequency conductor resistance.
- Dielectric loss may be specified through $\sigma$ or $\sigma/(\omega\epsilon')$.
- For an air-filled coaxial line, minimum skin-effect loss occurs at $b/a=3.6$, giving $Z_0=77\,\Omega$.
- Maximum pre-breakdown power occurs at $b/a=1.65$, giving $Z_0=30\,\Omega$.
- Microstrip analysis uses effective permittivity and the ratio $w/d$.
- A change in microstrip width creates an impedance junction and transmitted-power loss.

## Source Anchors

- Problem 13.1 specifies copper conductors, polyethylene dielectric, and inverse designs for $Z_0=50\,\Omega$, $C=100\,\mathrm{pF/m}$, and $L=0.2\,\mu\mathrm{H/m}$.
- Problems 13.2 through 13.5 request $R$, $L$, $C$, and $G$ or infer dielectric constant for coaxial and two-wire lines.
- Problem 13.6 states the target results $b/a=3.6$ for minimum skin-effect loss and $b/a=1.65$ for maximum power before air breakdown.
- Problem 13.7 combines characteristic impedance with the distortionless condition $RC=GL$.
- Problems 13.9 and 13.10 address microstrip effective permittivity, $w/d$, and junction loss between 4 mm and 5 mm lines on a 2 mm lithium-niobate wafer.

## Related Pages

- [[guided-mode-cutoff-and-single-mode-operation|Guided-Mode Cutoff and Single-Mode Operation]]
- [[waveguide-power-flow-and-field-structure|Waveguide Power Flow and Field Structure]]

## Concept Dependencies

- contrasts-with: [[guided-mode-cutoff-and-single-mode-operation|Guided-Mode Cutoff and Single-Mode Operation]]
