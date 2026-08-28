---
title: "1.213 Uniform Plane Waves from Sourceless Maxwell Equations"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 381", "Page 382"]
related: ["free-space-electromagnetic-wave-equation", "intrinsic-impedance-and-field-orientation", "vector-helmholtz-equation-in-free-space"]
---

# 1.213 Uniform Plane Waves from Sourceless Maxwell Equations

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 381, Page 382

A uniform plane wave is introduced as the simplest electromagnetic-wave model and as a useful approximation for practical waves over a limited region. In free space the medium is sourceless, so $\rho_v=0$ and $\mathbf{J}=0$, leaving Maxwell's equations in terms of $\mathbf{E}$ and $\mathbf{H}$. A time-varying electric field produces a magnetic field with curl, while a time-varying magnetic field produces an electric field with curl. This coupled process permits an electromagnetic disturbance to propagate without a transmission-line structure. For a uniform plane wave, both fields lie in a plane transverse to the direction of travel and remain constant in magnitude across that transverse plane, which is why the wave is also called transverse electromagnetic, or TEM. Choosing propagation along $z$ and electric polarization along $x$ restricts the fields to $\mathbf{E}=E_x\mathbf{a}_x$ and $\mathbf{H}=H_y\mathbf{a}_y$, with spatial variation only in $z$. Thus the electric field, magnetic field, and propagation direction are mutually orthogonal.

## Page-Grounded Details

#### Page 381

### The Uniform Plane Wave

This chapter is concerned with the application of Maxwell's equations to the problem of electromagnetic wave propagation. The uniform plane wave represents the simplest case, and while it is appropriate for an introduction, it is of great practical importance. Waves encountered in practice can often be assumed to be of this form. In this study, we will explore the basic principles of electromagnetic wave propagation, and we will come to understand the physical processes that determine the speed of propagation and the extent to which attenuation may occur. We will derive and use the Poynting theorem to find the power carried by a wave. Finally, we will learn how to describe wave polarization.

#### 11.1 WAVE PROPAGATION IN FREE SPACE

We begin with a quick study of Maxwell's equations, in which we look for clues of wave phenomena. In Chapter 10, we saw how voltages and currents propagate as waves in transmission lines, and we know that the existence of voltages and currents implies the existence of electric and magnetic fields. So we can identify a transmission line as a structure that confines the fields while enabling them to travel along its length as

[Truncated for analysis]

#### Page 382

may be written in terms of E and H only as

![Page 382 figure 1](/electromagnetism-1/assets/engineering-electromagnetics-9th-ed-9nbsped-compress-page-382-figure-1.png)

It is possible to infer wave motion from these four equations without actually solving them. Equation (1) states that if electric field E is changing with time at some point, then magnetic field H has curl at that point; therefore H varies spa-tially in a direction normal to its orientation direction. Also, if E is changing with time, then H will in general also change with time, although not necessarily in the same way. Next, we see from Eq. (2) that a time-varying H generates E, which, having curl, varies spatially in the direction normal to its orientation. We now have once more a changing electric field, our original hypothesis, but this field is present a small distance away from the point of the original disturbance. We might guess (correctly) that the velocity with which the effect moves away from the original point is the velocity of light, but this must be checked by a more detailed examination of Maxwell's equations.

We postulate the existence of a uniform plane wave, in which both fields, E and H, lie in

[Truncated for analysis]

## Core Ideas

- Free space is sourceless in this treatment: $\rho_v=0$ and $\mathbf{J}=0$.
- Time-varying electric and magnetic fields generate one another through Maxwell's curl equations.
- A uniform plane wave is constant across every plane transverse to propagation.
- A TEM wave has both $\mathbf{E}$ and $\mathbf{H}$ transverse to its propagation direction.
- For $+z$ propagation with $x$-polarized electric field, the magnetic field is $y$ directed.
- All field variation in the selected uniform-wave model occurs along $z$.
- Transmission-line waves provide a direct analogy for unconstrained field propagation.

## Source Anchors

- Page 381 describes a transmission line as a structure that confines fields while allowing them to propagate as voltage and current waves.
- The free-space assumptions are explicitly $\rho_v=\mathbf{J}=0$.
- For $\mathbf{E}=E_x\mathbf{a}_x$ varying only with $z$, the curl equation becomes $\nabla\times\mathbf{E}=(\partial E_x/\partial z)\mathbf{a}_y=-\mu_0(\partial H_y/\partial t)\mathbf{a}_y$.
- For $\mathbf{H}=H_y\mathbf{a}_y$ varying only with $z$, $\nabla\times\mathbf{H}=-(\partial H_y/\partial z)\mathbf{a}_x=\epsilon_0(\partial E_x/\partial t)\mathbf{a}_x$.
- Page 382 figure 1 should be retained as S1.P382.F1 and used as the source representation of the four sourceless Maxwell equations.

## Related Pages

- [[free-space-electromagnetic-wave-equation|Free-Space Electromagnetic Wave Equation]]
- [[intrinsic-impedance-and-field-orientation|Intrinsic Impedance and Field Orientation]]
- [[vector-helmholtz-equation-in-free-space|Vector Helmholtz Equation in Free Space]]

## Concept Dependencies

- enables: [[free-space-electromagnetic-wave-equation|Free-Space Electromagnetic Wave Equation]]
- enables: [[intrinsic-impedance-and-field-orientation|Intrinsic Impedance and Field Orientation]]
- applies-to: [[vector-helmholtz-equation-in-free-space|Vector Helmholtz Equation in Free Space]]
