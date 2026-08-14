---
title: "Rectangular Waveguide TM Eigenmodes"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "rectangular-waveguide-tm-eigenmodes"
locations: ["Page 496, Section 13.5.2", "Page 497, Equations (82) through (87)", "Page 498, Equations (88) through (91)"]
related: ["rectangular-waveguide-transverse-field-reconstruction", "rectangular-waveguide-te-eigenmodes", "rectangular-waveguide-cutoff-condition"]
---

## ConceptNode: Rectangular Waveguide TM Eigenmodes

Planning node for [[rectangular-waveguide-tm-eigenmodes|1.282 Rectangular Waveguide TM Eigenmodes]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 496, Section 13.5.2, Page 497, Equations (82) through (87), Page 498, Equations (88) through (91)

TM modes are obtained by solving the wave equation for the nonzero longitudinal electric field $E_z$. Separation of variables assumes each modal term has the form $F_m(x)G_p(y)e^{-j\beta_{mp}z}$. Substitution gives independent harmonic equations in $x$ and $y$, with $$\kappa_{mp}^2=\kappa_m^2+\kappa_p^2.$$ The general separated functions contain sine and cosine terms. Because $E_z$ is tangential to every conducting wall, it must vanish at $x=0$, $x=a$, $y=0$, and $y=b$. These conditions eliminate the cosine terms and require $$\kappa_m=\frac{m\pi}{a},\qquad \kappa_p=\frac{p\pi}{b}.$$ The longitudinal modal field is therefore $$E_{zs}=B\sin(\kappa_m x)\sin(\kappa_p y)e^{-j\beta_{mp}z}.$$ Maxwell's equations then generate $E_x$, $E_y$, $H_x$, and $H_y$ from derivatives of this field. Both mode indices must be at least one because setting either index to zero makes the entire TM field vanish.

### Key planning details

- TM modes have $H_z=0$ and $E_z\ne0$.
- The longitudinal electric field is separated into $x$, $y$, and $z$ factors.
- The transverse eigenvalues satisfy $\kappa_{mp}^2=\kappa_m^2+\kappa_p^2$.
- The conductor boundary condition requires $E_z=0$ on all four walls.
- The allowed constants are $\kappa_m=m\pi/a$ and $\kappa_p=p\pi/b$.
- The longitudinal field uses sine dependence in both transverse directions.
- Both $m$ and $p$ must be positive integers.
- The remaining field components follow from the longitudinal field through Maxwell's equations.

### Source coverage

- Equation (82) is the wave equation for $E_{zs}$.
- Equations (83) through (87) perform separation of variables and establish $\kappa_{mp}^2=\kappa_m^2+\kappa_p^2$.
- Equations (88) and (89) give the general sine-cosine separated solution.
- The boundary conditions require $E_{zs}=0$ at $x=0$, $x=a$, $y=0$, and $y=b$.
- Equations (90a) and (90b) quantize the transverse constants.
- Equations (91a) through (91e) give the longitudinal and transverse TM fields.
- The source explicitly states that both indices must be at least one.
