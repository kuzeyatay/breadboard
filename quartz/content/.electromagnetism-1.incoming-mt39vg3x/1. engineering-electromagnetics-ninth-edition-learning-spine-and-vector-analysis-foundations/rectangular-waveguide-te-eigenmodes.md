---
title: "1.283 Rectangular Waveguide TE Eigenmodes"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 499, Section 13.5.3 and Equations (92) through (96a)", "Page 500, Equations (96b) through (96e)"]
related: ["rectangular-waveguide-transverse-field-reconstruction", "rectangular-waveguide-tm-eigenmodes", "rectangular-waveguide-cutoff-condition"]
---

# 1.283 Rectangular Waveguide TE Eigenmodes

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 499, Section 13.5.3 and Equations (92) through (96a), Page 500, Equations (96b) through (96e)

TE modes are found by solving the wave equation for the nonzero longitudinal magnetic field $H_z$. The separated general solution initially contains sine and cosine terms in both transverse coordinates. The conducting-wall condition is imposed indirectly through the tangential electric field. Since $E_x$ must vanish at $y=0,b$, the derivative $\partial H_z/\partial y$ must vanish there. Since $E_y$ must vanish at $x=0,a$, $\partial H_z/\partial x$ must vanish there. These derivative boundary conditions select cosine dependence and yield the same quantized constants
$$
\kappa_m=\frac{m\pi}{a},\qquad \kappa_p=\frac{p\pi}{b}
$$
 The longitudinal field becomes
$$
H_{zs}=A\cos(\kappa_m x)\cos(\kappa_p y)e^{-j\beta_{mp}z}
$$
 Maxwell's equations then provide $H_x$, $H_y$, $E_x$, and $E_y$. Unlike TM modes, a TE mode may have either $m=0$ or $p=0$, permitting important families such as $\text{TE}_{m0}$ and $\text{TE}_{0p}$. Both indices cannot simultaneously produce a trivial field.

## Page-Grounded Details

#### Page 499

#### 13.5.3 TE Modes

To obtain the TE mode fields, we solve the wave equation for the $z$ component of $\mathbf{H}$ and then use Eq. (79) as before to find the transverse components. The wave equation is now the same as (82), except that $E_{zs}$ is replaced by $H_{zs}$:
$$
\frac{\partial^{2}H_{zs}}{\partial x^{2}}+\frac{\partial^{2}H_{zs}}{\partial y^{2}}+(k^{2}-\beta_{mp}^{2})H_{zs}=0\quad{(92)}
$$
and the solution is of the form:
$$
H_{zs}(x,y,z)=\sum_{m,p}F_{m}^{\,\prime}(x)\,G_{p}^{\,\prime}(y)\mathrm{exp}(-j\beta_{mp}\,z)\quad{(93)}
$$
The procedure from here is identical to that involving TM modes, and the general solution will be
$$
H_{zs}=[A_{m}^{\,\prime}\cos(\kappa_{m}x)+B_{m}^{\,\prime}\sin(\kappa_{m}x)][C_{p}^{\,\prime}\cos(\kappa_{p}y)+D_{p}^{\,\prime}\sin(\kappa_{p}y)]\mathrm{exp}(-j\beta_{mp}\,z)\quad{(94)}
$$
Again, the expression is simplified by using the appropriate boundary conditions. We know that tangential electric field must vanish on all conducting boundaries. When we relate the electric field to magnetic field derivatives using (79c) and (79d), the following conditions develop:
$$
E_{xs}\Big{|}_{y=0,b}=0\Rightarrow\frac{\partial H_{zs}}{\p

[Truncated for analysis]

#### Page 500

where we define $A =$ $A_{m}^{\prime}C_{p}^{\prime}$. Applying Eqs. (79a) through (79d) to (96a) gives the transverse field components:
$$
 H_{xs}=j\beta_{mp}\frac{\kappa_{m}}{\kappa_{mp}^{2}}A\sin(\kappa_{mr}x)\cos\big{(}\kappa_{p}y\big{)}\exp(-j\beta_{mp}\ z)(96b)
$$
$$
 H_{ys}=j\beta_{mp}\frac{\kappa_{p}}{\kappa_{mp}^{2}}A\cos(\kappa_{mr}x)\sin\big{(}\kappa_{p}y\big{)}\exp(-j\beta_{mp}\ z)(96c)
$$
$$
 E_{xs}=j\omega\mu\frac{\kappa_{p}}{\kappa_{mp}^{2}}A\cos(\kappa_{mr}x)\sin\big{(}\kappa_{p}y\big{)}\exp(-j\beta_{mp}\ z)(96d)
$$
$$
 E_{ys}=-j\omega\mu\frac{\kappa_{m}}{\kappa_{mp}^{2}}A\sin(\kappa_{mr}x)\cos\big{(}\kappa_{p}y\big{)}\exp(-j\beta_{mp}\ z)(96e)
$$
These field components pertain to modes designated $\text{TE}_{mp}$. For these modes, either m or p may be zero, thus allowing for the possibility of the important $\text{TE}_{m0}$ or $\text{TE}_{0p}$ cases, as will be discussed later. Some very good illustrations of TE and TM modes are presented in Reference 3.

#### 13.5.4 Cutoff Conditions

The phase constant for a given mode can be expressed using Eq. (81):
$$
 \beta_{mp}=\sqrt{k^{2}-\kappa_{mp}^{2}}(97) $$
Then, using (86), along with (90a) and (90b), we ha

[Truncated for analysis]

## Core Ideas

- TE modes have $E_z=0$ and $H_z\ne0$.
- The wave equation is solved for $H_z$.
- Zero tangential electric field becomes a zero-normal-derivative condition on $H_z$.
- $\partial H_z/\partial y=0$ at $y=0,b$.
- $\partial H_z/\partial x=0$ at $x=0,a$.
- The longitudinal magnetic field uses cosine dependence in both transverse coordinates.
- The allowed transverse constants remain $m\pi/a$ and $p\pi/b$.
- Either $m$ or $p$ may be zero for a TE mode.

## Source Anchors

- Equation (92) gives the wave equation for $H_{zs}$.
- Equations (93) and (94) give the separated general solution.
- Equations (95a) and (95b) translate tangential-electric-field conditions into derivative conditions on $H_z$.
- Equation (96a) gives $H_{zs}=A\cos(\kappa_m x)\cos(\kappa_p y)e^{-j\beta_{mp}z}$.
- Equations (96b) through (96e) give the transverse TE field components.
- The source states that either $m$ or $p$ may be zero, allowing $\text{TE}_{m0}$ and $\text{TE}_{0p}$ modes.

## Related Pages

- [[rectangular-waveguide-transverse-field-reconstruction|Rectangular Waveguide Transverse Field Reconstruction]]
- [[rectangular-waveguide-tm-eigenmodes|Rectangular Waveguide TM Eigenmodes]]
- [[rectangular-waveguide-cutoff-condition|Rectangular Waveguide Cutoff Condition]]

## Concept Dependencies

- applies-to: [[rectangular-waveguide-cutoff-condition|Rectangular Waveguide Cutoff Condition]]
