---
title: "1.282 Rectangular Waveguide TM Eigenmodes"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 496, Section 13.5.2", "Page 497, Equations (82) through (87)", "Page 498, Equations (88) through (91)"]
related: ["rectangular-waveguide-transverse-field-reconstruction", "rectangular-waveguide-te-eigenmodes", "rectangular-waveguide-cutoff-condition"]
---

# 1.282 Rectangular Waveguide TM Eigenmodes

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 496, Section 13.5.2, Page 497, Equations (82) through (87), Page 498, Equations (88) through (91)

TM modes are obtained by solving the wave equation for the nonzero longitudinal electric field $E_z$. Separation of variables assumes each modal term has the form $F_m(x)G_p(y)e^{-j\beta_{mp}z}$. Substitution gives independent harmonic equations in $x$ and $y$, with
$$
\kappa_{mp}^2=\kappa_m^2+\kappa_p^2
$$
 The general separated functions contain sine and cosine terms. Because $E_z$ is tangential to every conducting wall, it must vanish at $x=0$, $x=a$, $y=0$, and $y=b$. These conditions eliminate the cosine terms and require
$$
\kappa_m=\frac{m\pi}{a},\qquad \kappa_p=\frac{p\pi}{b}
$$
 The longitudinal modal field is therefore
$$
E_{zs}=B\sin(\kappa_m x)\sin(\kappa_p y)e^{-j\beta_{mp}z}
$$
 Maxwell's equations then generate $E_x$, $E_y$, $H_x$, and $H_y$ from derivatives of this field. Both mode indices must be at least one because setting either index to zero makes the entire TM field vanish.

## Page-Grounded Details

#### Page 496

of E and H. For example, (77a) and (78b) can be combined, eliminating $E_{ys}$, to give
$$
H_{xs}=\frac{-j}{\kappa^{2}}[\beta\frac{\partial H_{zs}}{\partial x}-\omega c\frac{\partial\,E_{zs}}{\partial y}]\quad{(79a)}
$$
Then, using (76b) and (77a), eliminate $E_{xs}$ between them to obtain
$$
H_{ys}=\frac{-j}{\kappa^{2}}[\beta\frac{\partial H_{zs}}{\partial y}+\omega c\frac{\partial E_{zs}}{\partial x}]\quad{(79b)}
$$
Using the same equation pairs, the transverse electric field components are then found:
$$
E_{xs}=\frac{-j}{\kappa^{2}}[\beta\frac{\partial E_{zs}}{\partial x}+\omega\mu\frac{\partial H_{zs}}{\partial y}]\quad{(79c)}
$$
$$
E_{ys}=\frac{-j}{\kappa^{2}}[\beta\frac{\partial E_{zs}}{\partial y}-\omega\mu\frac{\partial H_{zs}}{\partial x}]\quad{(79d)}
$$
$\kappa$ is defined in the same manner as in the parallel-plate guide [Eq. (35)]:
$$
\kappa=\sqrt{k^{2}-\beta^{2}}\quad{(80)}
$$
where $k=\omega\sqrt{\mu\epsilon}$. In the parallel-plate geometry, we found that discrete values of $\kappa$ and $\beta$ resulted from the analysis, which we then subscripted with the integer mode number, $m$ ($\kappa_{m}$ and $\beta_{m}$). The interpretation of $m$

[Truncated for analysis]

#### Page 497

the $z$ component of $E_{s}$:
$$
\frac{\partial^{2}E_{zs}}{\partial x^{2}}+\frac{\partial^{2}E_{zs}}{\partial y^{2}}+(k^{2}-\beta_{mp}^{2})E_{zs}=0 (82)
$$
The solution of (82) can be written as a sum of terms, each of which involves the product of three functions that exhibit individual variation with $x$, $y$, and $z$:
$$
E_{zs}(x,y,z)=\sum_{m,p}F_{m}(x)\ G_{p}(y)\exp(-j\beta_{mp}\ z) (83)
$$
where the functions $F_{m}(x)$ and $G_{p}(y)$ (not normalized) are to be determined. Each term in (83) corresponds to one mode of the guide, and will by itself be a solution to (82). To determine the functions, a single term in (83) is substituted into (82). Noting that all derivatives are applied to functions of a single variable (and thus partial derivatives become total derivatives), and using (81), the result is
$$
G_{p}(y)\frac{d^{2}F_{m}}{dx^{2}}+F_{m}(x)\frac{d^{2}G_{p}}{dy^{2}}+\kappa_{mp}^{2}\ F_{m}(x)\ G_{p}(y)=0 (84)
$$
in which the $\exp(-j\beta_{mp}\ z)$ term has divided out. Rearranging (84), we get
$$
\underbrace{\frac{1}{F_{m}}\frac{d^{2}F_{m}}{dx^{2}}}_{-\kappa_{m}^{2}}+\underbrace{\frac{1}{G_{p}}\frac{d^{2}G_{p}}{dy^{2}}}_{-\kappa_{p}^{2}}+\kappa_{mp}

[Truncated for analysis]

#### Page 498

Equation (87) is now easily solved. We obtain
$$
 F_{m}(x)= A_{m}\cos(\kappa_{m} x)+ B_{m} \sin(\kappa_{m} x)\qquad(88a)
$$
$$
 G_{p}(y)= C_{p}\cos(\kappa_{p} y)+ D_{p}\sin(\kappa_{p} y)\qquad(88b)
$$
Using these, along with (83), the general solution for $z$ component of $E_{s}$ for a single TM mode can be constructed:
$$
 E_{zs}=[A_{m}\cos(\kappa_{m} x)+B_{m}\sin(\kappa_{m} x)][C_{p}\cos(\kappa_{p} y)+D_{p}\sin(\kappa_{p} y)]\operatorname{exp}(-j\beta_{m p}z)\quad(89)
$$
The constants in (89) can be evaluated by applying the boundary conditions of the field on all four surfaces. Specifically, as $E_{zs}$ is tangent to all the conducting surfaces, it must vanish on all of them. Referring to Figure 13.7, the boundary conditions are
$$
 E_{zs}= 0\text{ at}x= 0\text{,}y= 0\text{,}x= a\text{, and}y= b
$$
Obtaining zero field at $x=0$ and $y=0$ is accomplished by dropping the cosine terms in (89) (setting $A_{m}=C_{p}=0$). The values of $\kappa_{m}$ and $\kappa_{p}$ that appear in the remaining sine terms are then set to the following, in order to assure zero field at $x=a$ and $y=b$:
$$
 \kappa_{m}=\frac{m\pi}{a}\qquad(90a)
$$
$$
 \kappa_{p}=\frac{p\pi}{b}\qquad

[Truncated for analysis]

## Core Ideas

- TM modes have $H_z=0$ and $E_z\ne0$.
- The longitudinal electric field is separated into $x$, $y$, and $z$ factors.
- The transverse eigenvalues satisfy $\kappa_{mp}^2=\kappa_m^2+\kappa_p^2$.
- The conductor boundary condition requires $E_z=0$ on all four walls.
- The allowed constants are $\kappa_m=m\pi/a$ and $\kappa_p=p\pi/b$.
- The longitudinal field uses sine dependence in both transverse directions.
- Both $m$ and $p$ must be positive integers.
- The remaining field components follow from the longitudinal field through Maxwell's equations.

## Source Anchors

- Equation (82) is the wave equation for $E_{zs}$.
- Equations (83) through (87) perform separation of variables and establish $\kappa_{mp}^2=\kappa_m^2+\kappa_p^2$.
- Equations (88) and (89) give the general sine-cosine separated solution.
- The boundary conditions require $E_{zs}=0$ at $x=0$, $x=a$, $y=0$, and $y=b$.
- Equations (90a) and (90b) quantize the transverse constants.
- Equations (91a) through (91e) give the longitudinal and transverse TM fields.
- The source explicitly states that both indices must be at least one.

## Related Pages

- [[rectangular-waveguide-transverse-field-reconstruction|Rectangular Waveguide Transverse Field Reconstruction]]
- [[rectangular-waveguide-te-eigenmodes|Rectangular Waveguide TE Eigenmodes]]
- [[rectangular-waveguide-cutoff-condition|Rectangular Waveguide Cutoff Condition]]

## Concept Dependencies

- contrasts-with: [[rectangular-waveguide-te-eigenmodes|Rectangular Waveguide TE Eigenmodes]]
- applies-to: [[rectangular-waveguide-cutoff-condition|Rectangular Waveguide Cutoff Condition]]
