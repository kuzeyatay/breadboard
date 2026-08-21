---
title: "TE_0p Modes and Rectangular-Guide Single-Mode Design"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "te-0p-modes-and-rectangular-guide-single-mode-design"
locations: ["Page 502, introduction to TE_0p", "Page 503, Figure 13.18(b) and Eqs. (113)-(118)", "Page 504, single-mode rectangular-waveguide example", "Page 505, Problem D13.10"]
related: ["rectangular-waveguide-cutoff-and-propagation", "te-m0-modes-and-the-dominant-te-10-mode", "why-rectangular-waveguides-are-needed"]
---

## ConceptNode: TE_0p Modes and Rectangular-Guide Single-Mode Design

Planning node for [[te-0p-modes-and-rectangular-guide-single-mode-design|1.287 TE_0p Modes and Rectangular-Guide Single-Mode Design]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 502, introduction to TE_0p, Page 503, Figure 13.18(b) and Eqs. (113)-(118), Page 504, single-mode rectangular-waveguide example, Page 505, Problem D13.10

The TE_0p family is obtained by setting $m=0$, leaving variation only along the y dimension. Its transverse wavenumber is $\kappa_p=p\pi/b$, and the surviving fields are $E_x$, $H_y$, and $H_z$. The electric field is horizontally polarized, as illustrated by the TE_01 pattern. Its cutoff frequency scales as $p/b$, so the smaller guide dimension generally places TE_01 above TE_10 in cutoff frequency when $a>b$. Single-mode design requires operation above the TE_10 cutoff but below the first competing cutoff, commonly TE_20 or TE_01. In the worked air-filled example with $a=2$ cm and $b=1$ cm, TE_20 and TE_01 have equal 15 GHz cutoffs because $a=2b$, while TE_10 cuts off at 7.5 GHz. The resulting strict single-mode interval is therefore $7.5\text{ GHz}<f<15\text{ GHz}$. The design exercise on Page 505 applies the same reasoning to dimension bounds over a specified frequency band.

### Key planning details

- For TE_0p, $\kappa_p=p\pi/b$ and $\kappa_m=0$.
- The surviving components are $E_x$, $H_y$, and $H_z$.
- TE_0p electric fields are horizontally polarized.
- The cutoff frequency is $\omega_{C0p}=p\pi c/(nb)$.
- Single-mode operation lies between the TE_10 cutoff and the lowest higher-order cutoff.
- When $a=2b$, TE_20 and TE_01 have the same cutoff frequency.
- For $a=2$ cm and $b=1$ cm in air, the single-mode interval is 7.5 GHz to 15 GHz.

### Source coverage

- S1.P503.F1, Figure 13.18(b), depicts the horizontally polarized TE_01 electric-field configuration.
- Equation (113): $$\kappa_p=\frac{p\pi}{b}.$$
- Equation (114): $$E_0'=j\frac{\omega\mu}{\kappa_p}A.$$
- Equations (115)-(117) give $E_x$, $H_y$, and $H_z$ with sinusoidal y dependence and propagation factor $e^{-j\beta_{0p}z}$.
- Equation (118): $$\omega_{C0p}=\frac{p\pi c}{nb}.$$
- The Page 504 example calculates $f_{C10}=7.5$ GHz and the common TE_20 and TE_01 cutoff as 15 GHz.
- Problem D13.10 gives the air-filled-guide design answer $a_{\min}=1$ cm and $b_{\max}=0.75$ cm for 15 GHz to 20 GHz operation.
