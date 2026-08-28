---
title: "Rectangular Waveguide TE Eigenmodes"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "rectangular-waveguide-te-eigenmodes"
locations: ["Page 499, Section 13.5.3 and Equations (92) through (96a)", "Page 500, Equations (96b) through (96e)"]
related: ["rectangular-waveguide-transverse-field-reconstruction", "rectangular-waveguide-tm-eigenmodes", "rectangular-waveguide-cutoff-condition"]
---

## ConceptNode: Rectangular Waveguide TE Eigenmodes

Planning node for [[rectangular-waveguide-te-eigenmodes|1.283 Rectangular Waveguide TE Eigenmodes]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 499, Section 13.5.3 and Equations (92) through (96a), Page 500, Equations (96b) through (96e)

TE modes are found by solving the wave equation for the nonzero longitudinal magnetic field $H_z$. The separated general solution initially contains sine and cosine terms in both transverse coordinates. The conducting-wall condition is imposed indirectly through the tangential electric field. Since $E_x$ must vanish at $y=0,b$, the derivative $\partial H_z/\partial y$ must vanish there. Since $E_y$ must vanish at $x=0,a$, $\partial H_z/\partial x$ must vanish there. These derivative boundary conditions select cosine dependence and yield the same quantized constants $$\kappa_m=\frac{m\pi}{a},\qquad \kappa_p=\frac{p\pi}{b}.$$ The longitudinal field becomes $$H_{zs}=A\cos(\kappa_m x)\cos(\kappa_p y)e^{-j\beta_{mp}z}.$$ Maxwell's equations then provide $H_x$, $H_y$, $E_x$, and $E_y$. Unlike TM modes, a TE mode may have either $m=0$ or $p=0$, permitting important families such as $\text{TE}_{m0}$ and $\text{TE}_{0p}$. Both indices cannot simultaneously produce a trivial field.

### Key planning details

- TE modes have $E_z=0$ and $H_z\ne0$.
- The wave equation is solved for $H_z$.
- Zero tangential electric field becomes a zero-normal-derivative condition on $H_z$.
- $\partial H_z/\partial y=0$ at $y=0,b$.
- $\partial H_z/\partial x=0$ at $x=0,a$.
- The longitudinal magnetic field uses cosine dependence in both transverse coordinates.
- The allowed transverse constants remain $m\pi/a$ and $p\pi/b$.
- Either $m$ or $p$ may be zero for a TE mode.

### Source coverage

- Equation (92) gives the wave equation for $H_{zs}$.
- Equations (93) and (94) give the separated general solution.
- Equations (95a) and (95b) translate tangential-electric-field conditions into derivative conditions on $H_z$.
- Equation (96a) gives $H_{zs}=A\cos(\kappa_m x)\cos(\kappa_p y)e^{-j\beta_{mp}z}$.
- Equations (96b) through (96e) give the transverse TE field components.
- The source states that either $m$ or $p$ may be zero, allowing $\text{TE}_{m0}$ and $\text{TE}_{0p}$ modes.
