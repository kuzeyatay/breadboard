---
title: "1.287 TE_0p Modes and Rectangular-Guide Single-Mode Design"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 502, introduction to TE_0p", "Page 503, Figure 13.18(b) and Eqs. (113)-(118)", "Page 504, single-mode rectangular-waveguide example", "Page 505, Problem D13.10"]
related: ["rectangular-waveguide-cutoff-and-propagation", "te-m0-modes-and-the-dominant-te-10-mode", "why-rectangular-waveguides-are-needed"]
---

# 1.287 TE_0p Modes and Rectangular-Guide Single-Mode Design

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 502, introduction to TE_0p, Page 503, Figure 13.18(b) and Eqs. (113)-(118), Page 504, single-mode rectangular-waveguide example, Page 505, Problem D13.10

The TE_0p family is obtained by setting $m=0$, leaving variation only along the y dimension. Its transverse wavenumber is $\kappa_p=p\pi/b$, and the surviving fields are $E_x$, $H_y$, and $H_z$. The electric field is horizontally polarized, as illustrated by the TE_01 pattern. Its cutoff frequency scales as $p/b$, so the smaller guide dimension generally places TE_01 above TE_10 in cutoff frequency when $a>b$. Single-mode design requires operation above the TE_10 cutoff but below the first competing cutoff, commonly TE_20 or TE_01. In the worked air-filled example with $a=2$ cm and $b=1$ cm, TE_20 and TE_01 have equal 15 GHz cutoffs because $a=2b$, while TE_10 cuts off at 7.5 GHz. The resulting strict single-mode interval is therefore $7.5\text{ GHz}<f<15\text{ GHz}$. The design exercise on Page 505 applies the same reasoning to dimension bounds over a specified frequency band.

## Page-Grounded Details

#### Page 502

Substituting (104) and (105) into Eqs. (96$e$), (96$c$), and (96$a$) leads to the following expressions for the ${TE}_{m0}$ mode fields:
$$
E_{ys}= E_{0} \sin( \kappa_{m} x) e^{-j \beta_{m0} z}
$$
(106)
$$
H_{xs}= - \frac{\beta_{m0}}{\omega \mu} E_{0} \sin( \kappa_{m} x) e^{-j \beta_{m0} z}
$$
(107)
$$
H_{zs}= j \frac{\kappa_{m}}{\omega \mu} E_{0} \cos( \kappa_{m} x) e^{-j \beta_{m0} z}
$$
(108)

It can be seen that these expressions are identical to the parallel-plate fields, Eqs. (65), (71), and (72). For ${TE}_{m0}$, we again note that the subscripts indicate that there are $m$ half cycles of the electric field over the $x$ dimension and there is zero variation in $y$. The cutoff frequency for the ${TE}_{m0}$ mode is given by (101), appropriately modified:
$$
\omega_{Cm0}= \frac{m\pi c}{na}
$$
(109)

Using (109) in (99), the phase constant is
$$
\beta_{m0}= \frac{n\omega}{c} \sqrt{1-(\frac{m\pi c}{\omega na})^2}
$$
(110)

All of the implications on mode behavior above and below cutoff are exactly the same as we found for the parallel-plate guide. The plane wave analysis is also carried out in the same manner. ${TE}_{m0}$ modes can be modeled as plan

[Truncated for analysis]

#### Page 503

Figure 13.18 (a) TE_10 and (b) TE_01 mode electric field configurations in a rectangular waveguide.

which means, using (86) and (90), that
$$
\kappa_{p}=\kappa_{mp}\rvert_{m=0}=\frac{p\pi}{b}\quad{(113)}
$$
and $\kappa_{m}=0$. Now, the surviving field components in Eqs. (91a) through (91e) will be $E_{xs}$, $H_{ys}$, and $H_{zs}$. Now, define the electric field amplitude, $E_{0}^{\prime}$, which is composed of all the amplitude terms in Eq. (96d):
$$
E_{0}^{\prime}=j\omega\mu\frac{\kappa_{p}}{\kappa_{0p}^{2}}A=j\frac{\omega\mu}{\kappa_{p}}A\quad{(114)}
$$
Using (113) and (114) in Eqs. (96d), (96b), and (96a) leads to the following expressions for the TE_0ₚ mode fields:
$$
E_{xs}=E_{0}\sin\left(\kappa_{p}y\right)e^{-j\beta_{0p}z}\quad{(115)}
$$
$$
H_{ys}=\frac{\beta_{0p}}{\omega\mu}E_{0}\sin\left(\kappa_{p}y\right)e^{-j\beta_{0p}z}\quad{(116)}
$$
$$
H_{zs}=-j\frac{\kappa_{p}}{\omega\mu}E_{0}\cos\left(\kappa_{p}y\right)e^{-j\beta_{0p}z}\quad{(117)}
$$
where the cutoff frequency will be
$$
\omega_{C0p}=\frac{p\pi c}{nb}\quad{(118)}
$$
#### Page 504

An air-filled rectangular waveguide has dimensions $a=2$ cm and $b=1$ cm. Deter-mine the range of frequencies over which the guide will operate single mode (TE_10).

Solution. Since the guide is air-filled, $n=1$, and (109) gives, for $m=1$:
$$
f_{C10}=\frac{\omega_{C10}}{2\pi}=\frac{c}{2a}=\frac{3\times 10^{10}}{2(2)}=7.5\,{\rm GHz}
$$
The next higher-order mode will be either TE_20 or TE_01, which from (100) will have the same cutoff frequency because $a=2b$. This frequency will be twice that found for TE_10, or 15 GHz. Thus the operating frequency range over which the guide will be single mode is 7.5 GHz $<f<$ 15 GHz.

#### 13.5.6 The Need for Rectangular Waveguides

Having seen how rectangular waveguides work, questions arise: Why are they used, and when are they useful? Let us consider for a moment the operation of a transmis-sion line at frequencies high enough such that waveguide modes can occur. The onset of guided modes in a transmission line, known as moding, is in fact a problem that needs to be avoided, because signal distortion may result. A signal that is input to such a line will find its power divided in some proportions among the various modes. The si

[Truncated for analysis]

#### Page 505

Because the rectangular guide will not support a TEM mode, it will not operate until the frequency exceeds the cutoff frequency of the lowest-order guided mode of the structure. Thus, the guide must be constructed large enough to accomplish this for a given frequency; the required transverse dimensions will consequently be larger than those of a transmission line that is designed to support only the TEM mode. The increased size, coupled with the fact that there is more conductor surface area than in a transmission line of equal volume, means that losses will be substantially lower in the rectangular waveguide structure. Additionally, the guides will support more power at a given electric field strength than a transmission line, as the rectangular guide will have a higher cross-sectional area.

Still, hollow pipe guides must operate in a single mode in order to avoid the signal distortion problems arising from multimode transmission. This means that the guides must be of dimensions such that they operate above the cutoff frequency of the lowest-order mode, but below the cutoff frequency of the next higher-order mode, as demonstrated in Example 13.4. Increasing the operating frequenc

[Truncated for analysis]

## Core Ideas

- For TE_0p, $\kappa_p=p\pi/b$ and $\kappa_m=0$.
- The surviving components are $E_x$, $H_y$, and $H_z$.
- TE_0p electric fields are horizontally polarized.
- The cutoff frequency is $\omega_{C0p}=p\pi c/(nb)$.
- Single-mode operation lies between the TE_10 cutoff and the lowest higher-order cutoff.
- When $a=2b$, TE_20 and TE_01 have the same cutoff frequency.
- For $a=2$ cm and $b=1$ cm in air, the single-mode interval is 7.5 GHz to 15 GHz.

## Source Anchors

- S1.P503.F1, Figure 13.18(b), depicts the horizontally polarized TE_01 electric-field configuration.
- Equation (113):
$$
\kappa_p=\frac{p\pi}{b}
$$
- Equation (114):
$$
E_0'=j\frac{\omega\mu}{\kappa_p}A
$$
- Equations (115)-(117) give $E_x$, $H_y$, and $H_z$ with sinusoidal y dependence and propagation factor $e^{-j\beta_{0p}z}$.
- Equation (118):
$$
\omega_{C0p}=\frac{p\pi c}{nb}
$$
- The Page 504 example calculates $f_{C10}=7.5$ GHz and the common TE_20 and TE_01 cutoff as 15 GHz.
- Problem D13.10 gives the air-filled-guide design answer $a_{\min}=1$ cm and $b_{\max}=0.75$ cm for 15 GHz to 20 GHz operation.

## Related Pages

- [[rectangular-waveguide-cutoff-and-propagation|Rectangular Waveguide Cutoff and Propagation]]
- [[te-m0-modes-and-the-dominant-te-10-mode|TE_m0 Modes and the Dominant TE_10 Mode]]
- [[why-rectangular-waveguides-are-needed|Why Rectangular Waveguides Are Needed]]

## Concept Dependencies

- depends-on: [[te-m0-modes-and-the-dominant-te-10-mode|TE_m0 Modes and the Dominant TE_10 Mode]]
- applies-to: [[why-rectangular-waveguides-are-needed|Why Rectangular Waveguides Are Needed]]
