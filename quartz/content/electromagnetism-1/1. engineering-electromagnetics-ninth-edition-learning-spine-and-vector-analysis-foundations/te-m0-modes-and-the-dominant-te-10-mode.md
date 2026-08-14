---
title: "1.286 TE_m0 Modes and the Dominant TE_10 Mode"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 501, Section 13.5.5 and Eqs. (104)-(105)", "Page 502, Eqs. (106)-(112)", "Page 503, Figure 13.18(a)"]
related: ["rectangular-waveguide-cutoff-and-propagation", "te-0p-modes-and-rectangular-guide-single-mode-design", "why-rectangular-waveguides-are-needed"]
---

# 1.286 TE_m0 Modes and the Dominant TE_10 Mode

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 501, Section 13.5.5 and Eqs. (104)-(105), Page 502, Eqs. (106)-(112), Page 503, Figure 13.18(a)

For a rectangular guide with $a>b$, inspection of the cutoff expression shows that the lowest cutoff frequency belongs to TE_10. It has $m=1$ and $p=0$, while a corresponding TM_10 mode does not exist. More generally, setting $p=0$ gives the TE_m0 family, whose transverse wavenumber is $\kappa_m=m\pi/a$ and whose nonzero field components are $E_y$, $H_x$, and $H_z$. These fields have the same form as the corresponding parallel-plate-guide fields, so TE_m0 modes can be interpreted as plane waves reflecting between the vertical sidewalls. The index m counts the number of electric-field half-cycles across the x dimension, and the zero index denotes no y variation. For TE_10, the electric field is vertically polarized, reaches zero at the vertical conducting walls, and terminates normally on the top and bottom plates. Its cutoff occurs when the broad guide dimension a equals one-half wavelength in the filling medium.

## Page-Grounded Details

#### Page 501

$b$, along with the material properties, $\epsilon_{r}$ and $\mu_{r}$, will determine the number of modes that will propagate. For the typical case in which $\mu_{r}=1$, using $n=\sqrt{\epsilon_{r}}$, and identi-
fying the speed of light, $c=1/\sqrt{\mu_{0}\epsilon_{0}}$, we may re-write (100) in a manner consistent
with Eq. (41):
$$
\omega_{Cmp}=\frac{c}{n}\left[\left(\frac{m\pi}{a}\right)^{2}+\left(\frac{p\pi}{b}\right)^{2}\right]^{1/2}\quad{(101)}
$$
This would lead to an expression for the cutoff wavelength, $\lambda_{Cmp}$, in a manner con-
sistent with Eq. (43):
$$
\lambda_{Cmp}=\frac{2\pi c}{\omega_{Cmp}}=2n\left[\left(\frac{m}{a}\right)^{2}+\left(\frac{p}{b}\right)^{2}\right]^{-1/2}\quad{(102)}
$$
$\lambda_{Cmp}$ is the free space wavelength at cutoff. If measured in the medium that fills the
waveguide, the cutoff wavelength would be given by Eq. (102) divided by $n$.

Now, in a manner consistent with Eq. (44), Eq. (99) becomes
$$
\beta_{mp}=\frac{2\pi n}{\lambda}\sqrt{1-\left(\frac{\lambda}{\lambda_{Cmp}}\right)^{2}}\quad{(103)}
$$
where $\lambda$ is the free space wavelength. As we saw before, a TE$_{mp}$ or TM$_{mp}$ mode can
propagate if it

[Truncated for analysis]

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
## Core Ideas

- When $a>b$, TE_10 has the lowest rectangular-guide cutoff frequency.
- TM_10 does not exist, even though TE_10 does.
- For TE_m0, $\kappa_m=m\pi/a$ and $\kappa_p=0$.
- The surviving components are $E_y$, $H_x$, and $H_z$.
- The index m counts electric-field half-cycles across x.
- TE_m0 modes are equivalent in form to parallel-plate modes.
- The TE_10 cutoff wavelength is $\lambda_{C10}=2na$.

## Source Anchors

- Equation (104):
$$
\kappa_m=\frac{m\pi}{a}
$$
- Equation (105) defines the amplitude:
$$
E_0=-j\frac{\omega\mu}{\kappa_m}A
$$
- Equations (106)-(108):
$$
E_y=E_0\sin(\kappa_mx)e^{-j\beta_{m0}z}
$$
$$
H_x=-\frac{\beta_{m0}}{\omega\mu}E_0\sin(\kappa_mx)e^{-j\beta_{m0}z}
$$
$$
H_z=j\frac{\kappa_m}{\omega\mu}E_0\cos(\kappa_mx)e^{-j\beta_{m0}z}
$$
- Equation (109):
$$
\omega_{Cm0}=\frac{m\pi c}{na}
$$
- Equation (111):
$$
E_y=E_0\sin\left(\frac{\pi x}{a}\right)e^{-j\beta_{10}z}
$$
- Equation (112):
$$
\lambda_{C10}=2na
$$
- S1.P503.F1, Figure 13.18(a), depicts the vertically polarized TE_10 electric field, with zero tangential electric field at the vertical conducting walls.

## Related Pages

- [[rectangular-waveguide-cutoff-and-propagation|Rectangular Waveguide Cutoff and Propagation]]
- [[te-0p-modes-and-rectangular-guide-single-mode-design|TE_0p Modes and Rectangular-Guide Single-Mode Design]]
- [[why-rectangular-waveguides-are-needed|Why Rectangular Waveguides Are Needed]]

## Concept Dependencies

- derives-from: [[rectangular-waveguide-cutoff-and-propagation|Rectangular Waveguide Cutoff and Propagation]]
- contrasts-with: [[te-0p-modes-and-rectangular-guide-single-mode-design|TE_0p Modes and Rectangular-Guide Single-Mode Design]]
