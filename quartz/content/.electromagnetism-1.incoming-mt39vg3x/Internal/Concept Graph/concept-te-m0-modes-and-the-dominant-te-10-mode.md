---
title: "TE_m0 Modes and the Dominant TE_10 Mode"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "te-m0-modes-and-the-dominant-te-10-mode"
locations: ["Page 501, Section 13.5.5 and Eqs. (104)-(105)", "Page 502, Eqs. (106)-(112)", "Page 503, Figure 13.18(a)"]
related: ["rectangular-waveguide-cutoff-and-propagation", "te-0p-modes-and-rectangular-guide-single-mode-design", "why-rectangular-waveguides-are-needed"]
---

## ConceptNode: TE_m0 Modes and the Dominant TE_10 Mode

Planning node for [[te-m0-modes-and-the-dominant-te-10-mode|1.286 TE_m0 Modes and the Dominant TE_10 Mode]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 501, Section 13.5.5 and Eqs. (104)-(105), Page 502, Eqs. (106)-(112), Page 503, Figure 13.18(a)

For a rectangular guide with $a>b$, inspection of the cutoff expression shows that the lowest cutoff frequency belongs to TE_10. It has $m=1$ and $p=0$, while a corresponding TM_10 mode does not exist. More generally, setting $p=0$ gives the TE_m0 family, whose transverse wavenumber is $\kappa_m=m\pi/a$ and whose nonzero field components are $E_y$, $H_x$, and $H_z$. These fields have the same form as the corresponding parallel-plate-guide fields, so TE_m0 modes can be interpreted as plane waves reflecting between the vertical sidewalls. The index m counts the number of electric-field half-cycles across the x dimension, and the zero index denotes no y variation. For TE_10, the electric field is vertically polarized, reaches zero at the vertical conducting walls, and terminates normally on the top and bottom plates. Its cutoff occurs when the broad guide dimension a equals one-half wavelength in the filling medium.

### Key planning details

- When $a>b$, TE_10 has the lowest rectangular-guide cutoff frequency.
- TM_10 does not exist, even though TE_10 does.
- For TE_m0, $\kappa_m=m\pi/a$ and $\kappa_p=0$.
- The surviving components are $E_y$, $H_x$, and $H_z$.
- The index m counts electric-field half-cycles across x.
- TE_m0 modes are equivalent in form to parallel-plate modes.
- The TE_10 cutoff wavelength is $\lambda_{C10}=2na$.

### Source coverage

- Equation (104): $$\kappa_m=\frac{m\pi}{a}.$$
- Equation (105) defines the amplitude: $$E_0=-j\frac{\omega\mu}{\kappa_m}A.$$
- Equations (106)-(108): $$E_y=E_0\sin(\kappa_mx)e^{-j\beta_{m0}z},$$ $$H_x=-\frac{\beta_{m0}}{\omega\mu}E_0\sin(\kappa_mx)e^{-j\beta_{m0}z},$$ $$H_z=j\frac{\kappa_m}{\omega\mu}E_0\cos(\kappa_mx)e^{-j\beta_{m0}z}.$$
- Equation (109): $$\omega_{Cm0}=\frac{m\pi c}{na}.$$
- Equation (111): $$E_y=E_0\sin\left(\frac{\pi x}{a}\right)e^{-j\beta_{10}z}.$$
- Equation (112): $$\lambda_{C10}=2na.$$
- S1.P503.F1, Figure 13.18(a), depicts the vertically polarized TE_10 electric field, with zero tangential electric field at the vertical conducting walls.
