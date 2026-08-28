---
title: "1.214 Free-Space Electromagnetic Wave Equation"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 382", "Page 383"]
related: ["uniform-plane-waves-from-sourceless-maxwell-equations", "traveling-wave-direction-and-sinusoidal-solutions", "vector-helmholtz-equation-in-free-space"]
---

# 1.214 Free-Space Electromagnetic Wave Equation

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 382, Page 383

The coupled first-order Maxwell equations reduce to separate second-order wave equations for the electric and magnetic fields. With $E_x$ and $H_y$ varying only along $z$, the governing pair is $\partial E_x/\partial z=-\mu_0\partial H_y/\partial t$ and $\partial H_y/\partial z=-\epsilon_0\partial E_x/\partial t$. Differentiating the first equation with respect to $z$ and the second with respect to $t$ creates the same mixed derivative of $H_y$. Substitution eliminates the magnetic field and yields the electric-field wave equation. Reversing the elimination gives the identical form for $H_y$. Comparing the resulting equation with the standard one-dimensional wave equation identifies the propagation speed as $1/\sqrt{\mu_0\epsilon_0}$, which equals the free-space speed of light. This derivation shows that light speed is set by the electric and magnetic constitutive properties of free space. It also makes the mathematical analogy to the lossless telegraphist's equations explicit.

## Page-Grounded Details

#### Page 382

may be written in terms of E and H only as

![Page 382 figure 1](/electromagnetism-1/assets/engineering-electromagnetics-9th-ed-9nbsped-compress-page-382-figure-1.png)

It is possible to infer wave motion from these four equations without actually solving them. Equation (1) states that if electric field E is changing with time at some point, then magnetic field H has curl at that point; therefore H varies spa-tially in a direction normal to its orientation direction. Also, if E is changing with time, then H will in general also change with time, although not necessarily in the same way. Next, we see from Eq. (2) that a time-varying H generates E, which, having curl, varies spatially in the direction normal to its orientation. We now have once more a changing electric field, our original hypothesis, but this field is present a small distance away from the point of the original disturbance. We might guess (correctly) that the velocity with which the effect moves away from the original point is the velocity of light, but this must be checked by a more detailed examination of Maxwell's equations.

We postulate the existence of a uniform plane wave, in which both fields, E and H, lie in

[Truncated for analysis]

#### Page 383

Equations (5) and (6) can be more succinctly written:
$$
\frac{\partial E_{x}}{\partial z}=-\mu_{0}\frac{\partial H_{y}}{\partial t}\quad{(7)}
$$
$$
\frac{\partial H_{y}}{\partial z}=-\epsilon_{0}\frac{\partial E_{x}}{\partial t}\quad{(8)}
$$
These equations compare directly with the telegraphist's equations for the lossless transmission line [Eqs. (20) and (21) in Chapter 10]. Further manipulations of (7) and (8) proceed in the same manner as was done with the telegraphist's equations. Specifically, we differentiate (7) with respect to z, obtaining:
$$
\frac{\partial^{2}E_{x}}{\partial z^{2}}=-\mu_{0}\frac{\partial^{2}H_{y}}{\partial t\partial z}\quad{(9)}
$$
Then, (8) is differentiated with respect to t:
$$
\frac{\partial^{2}H_{y}}{\partial z\partial t}=-\epsilon_{0}\frac{\partial^{2}E_{x}}{\partial t^{2}}\quad{(10)}
$$
Substituting (10) into (9) results in
$$
\frac{\partial^{2}E_{x}}{\partial z^{2}}=\mu_{0}\epsilon_{0}\frac{\partial^{2}E_{x}}{\partial t^{2}}\quad{(11)}
$$
This equation, in direct analogy to Eq. (13) in Chapter 10, we identify as the wave equation for our x-polarized TEM electric field in free space. From Eq. (11), we further identify the propagation vel

[Truncated for analysis]

## Core Ideas

- The first-order field equations couple spatial variation of one field to time variation of the other.
- Differentiation and substitution eliminate one field to obtain a second-order wave equation.
- The electric-field equation is $\partial^2E_x/\partial z^2=\mu_0\epsilon_0\partial^2E_x/\partial t^2$.
- The magnetic field satisfies the same wave-equation form.
- The free-space propagation speed is $v=1/\sqrt{\mu_0\epsilon_0}$.
- Numerically, $v=3\times10^8\,\mathrm{m/s}=c$.
- The derivation parallels the lossless transmission-line wave equation.

## Source Anchors

- Equations (7) and (8) are $\frac{\partial E_x}{\partial z}=-\mu_0\frac{\partial H_y}{\partial t}$ and $\frac{\partial H_y}{\partial z}=-\epsilon_0\frac{\partial E_x}{\partial t}$.
- Equations (9) and (10) introduce compatible mixed derivatives by differentiating with respect to $z$ and $t$.
- Equation (11) is $\frac{\partial^2E_x}{\partial z^2}=\mu_0\epsilon_0\frac{\partial^2E_x}{\partial t^2}$.
- Equation (12) gives $v=1/\sqrt{\mu_0\epsilon_0}=3\times10^8\,\mathrm{m/s}=c$.
- Equation (13) gives $\frac{\partial^2H_y}{\partial z^2}=\mu_0\epsilon_0\frac{\partial^2H_y}{\partial t^2}$.

## Related Pages

- [[uniform-plane-waves-from-sourceless-maxwell-equations|Uniform Plane Waves from Sourceless Maxwell Equations]]
- [[traveling-wave-direction-and-sinusoidal-solutions|Traveling-Wave Direction and Sinusoidal Solutions]]
- [[vector-helmholtz-equation-in-free-space|Vector Helmholtz Equation in Free Space]]

## Concept Dependencies

- derives-from: [[uniform-plane-waves-from-sourceless-maxwell-equations|Uniform Plane Waves from Sourceless Maxwell Equations]]
- enables: [[traveling-wave-direction-and-sinusoidal-solutions|Traveling-Wave Direction and Sinusoidal Solutions]]
- related: [[vector-helmholtz-equation-in-free-space|Vector Helmholtz Equation in Free Space]]
