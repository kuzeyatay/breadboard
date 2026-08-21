---
title: "1.96 One-Dimensional Poisson Solution for a pn Junction"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 183", "Page 184", "Page 185"]
related: ["derivation-of-poissons-equation", "pn-junction-voltage-and-differential-capacitance", "laplace-and-poisson-boundary-value-problem-family"]
---

# 1.96 One-Dimensional Poisson Solution for a pn Junction

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 183, Page 184, Page 185

The pn-junction example applies Poisson's equation to a specified smooth approximation of depletion-region charge. The p-type material occupies $x<0$ and the n-type material occupies $x>0$, with equal doping magnitudes. Hole and electron diffusion creates negative charge on the p side, positive charge on the n side, and an electric field directed toward negative $x$. The assumed charge density is
$$
\rho_v=2\rho_{v0}\operatorname{sech}\left(\frac{x}{a}\right)\tanh\left(\frac{x}{a}\right)
$$
 where the maximum magnitude is $\rho_{v0}$ at $x=0.881a$. Equal donor and acceptor concentrations give $\rho_{v0}=eN_a=eN_d$. With no $y$ or $z$ variation, Poisson's equation becomes an ordinary differential equation. Integrating once and imposing $E_x\to0$ as $x\to\pm\infty$ gives
$$
E_x=-\frac{2\rho_{v0}a}{\epsilon}\operatorname{sech}\left(\frac{x}{a}\right)
$$
 A second integration, with $V=0$ at $x=0$, gives the antisymmetric junction potential in Equation (46).

## Page-Grounded Details

#### Page 183

#### 6.8 EXAMPLE OF THE SOLUTION OF POISSON'S EQUATION: THE P-N JUNCTION CAPACITANCE

To select a reasonably simple problem that might illustrate the application of Poisson's equation, we must assume that the volume charge density is specified. This is not usually the case, however; in fact, it is often the quantity about which we are seeking further information. The type of problem which we might encounter later would begin with a knowledge only of the boundary values of the potential, the electric field intensity, and the current density. From these we would have to apply Poisson's equation, the continuity equation, and some relationship expressing the forces on the charged particles, such as the Lorentz force equation or the diffusion equation, and solve the whole system of equations simultaneously. Such an ordeal is beyond the scope of this text, and we will therefore assume a reasonably large amount of information.

As an example, consider a pn junction between two halves of a semiconductor bar extending in the x direction. We will assume that the region for x < 0 is doped p type and that the region for x > 0 is n type. The degree of doping is identical on each side of the jun

[Truncated for analysis]

#### Page 184

Figure 6.12 (a) The charge density, (b) the electric field intensity, and (c) the potential are plotted for a $pn$ junction as functions of distance from the center of the junction. The $p$-type material is on the left, and the $n$-type is on the right.

#### Page 185

subject to the charge distribution assumed above,
$$
\frac{d^{2}V}{dx^{2}}=-\frac{2\rho_{v0}}{\epsilon}\operatorname{sech}\frac{x}{a}\tanh\frac{x}{a}
$$
in this one-dimensional problem in which variations with y and z are not present. We integrate once,
$$
\frac{dV}{dx}=\frac{2\rho_{v0}a}{\epsilon}\operatorname{sech}\frac{x}{a}+C_{1}
$$
and obtain the electric field intensity,
$$
E_{x}=-\frac{2\rho_{v0}a}{\epsilon}\operatorname{sech}\frac{x}{a}-C_{1}
$$
To evaluate the constant of integration $C_{1}$, we note that no net charge density and no fields can exist far from the junction. Thus, as $x\rightarrow\pm\infty$, $E_{x}$ must approach zero. Therefore $C_{1}=0$, and
$$
E_{x}=-\frac{2\rho_{v0}a}{\epsilon}\operatorname{sech}\frac{x}{a}\quad{(45)}
$$
Integrating again,
$$
V=\frac{4\rho_{v0}a^{2}}{\epsilon}\tan^{-1}\,e^{x/a}+C_{2}
$$
The zero reference of potential is arbitrarily set at the center of the junction, $x=0$,
$$
0=\frac{4\rho_{v0}a^{2}}{\epsilon}\frac{\pi}{4}+C_{2}
$$
and finally,
$$
V=\frac{4\rho_{v0}a^{2}}{\epsilon}\left(\tan^{-1}\,e^{x/a}-\frac{\pi}{4}\right)\quad{(46)}
$$
Figure 6.12 shows the charge distribution (a), electric field intensity (b

[Truncated for analysis]

## Core Ideas

- The p region is at $x<0$ and the n region is at $x>0$.
- Diffusion leaves negative charge on the p side and positive charge on the n side.
- The built-in electric field points toward negative $x$.
- The charge profile uses a product of $\operatorname{sech}(x/a)$ and $\tanh(x/a)$.
- Equal doping gives $\rho_{v0}=eN_a=eN_d$.
- The far-field condition forces the first integration constant to zero.
- The potential reference is chosen at the junction center.

## Source Anchors

- Equation (44) specifies the smooth volume-charge profile.
- The maximum charge density occurs at $x=0.881a$.
- S1.P184.F1, Figure 6.12(a) plots negative charge on the p side and positive charge on the n side.
- S1.P184.F2, Figure 6.12(b) plots the negative electric field.
- Equation (45) gives the electric field profile.
- Equation (46) gives
$$
V=\frac{4\rho_{v0}a^2}{\epsilon}\left(\tan^{-1}e^{x/a}-\frac{\pi}{4}\right)
$$
- S1.P184.F3, Figure 6.12(c) plots the potential across the junction.

## Related Pages

- [[derivation-of-poissons-equation|Derivation of Poisson's Equation]]
- [[pn-junction-voltage-and-differential-capacitance|pn Junction Voltage and Differential Capacitance]]
- [[laplace-and-poisson-boundary-value-problem-family|Laplace and Poisson Boundary-Value Problem Family]]

## Concept Dependencies

- applies-to: [[derivation-of-poissons-equation|Derivation of Poisson's Equation]]
- enables: [[pn-junction-voltage-and-differential-capacitance|pn Junction Voltage and Differential Capacitance]]
