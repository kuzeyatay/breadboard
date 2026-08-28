---
title: "1.327 Broadside and Endfire Two-Element Arrays"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 552", "Page 553", "Section 14.5.2", "Example 14.3", "Example 14.4", "Problem D14.6", "Problem D14.7"]
related: ["two-element-array-far-zone-phase-geometry", "pattern-multiplication-for-antenna-arrays", "uniform-linear-array-beam-conditions"]
---

# 1.327 Broadside and Endfire Two-Element Arrays

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 552, Page 553, Section 14.5.2, Example 14.3, Example 14.4, Problem D14.6, Problem D14.7

The H-plane beam direction of a two-element array is controlled through spacing $d$ and relative current phase $\xi$. With in-phase currents, $\xi=0$, the array factor is $A=\cos[(\pi d/\lambda)\cos\phi]$. It always reaches a maximum at $\phi=90^\circ$ and $270^\circ$, normal to the plane containing the antennas, which defines broadside operation. Choosing $d=\lambda/2$ additionally creates zeros along the array axis at $\phi=0$ and $180^\circ$. Larger spacing can introduce sidelobes. Endfire operation instead places a maximum along the array axis. The condition is $\xi/2\pm\pi d/\lambda=m\pi$, where the sign selects the positive or negative $x$ direction. A practical unidirectional case uses $d=\lambda/4$ and $\xi=-\pi/2$. Its factor $A=\cos[(\pi/4)(\cos\phi-1)]$ is maximum at $\phi=0$ and zero at $\phi=\pi$. The imposed current lag compensates propagation delay in the forward direction and reinforces it in the reverse direction, producing constructive interference forward and destructive interference backward.

## Page-Grounded Details

#### Page 552
$$
E_{\theta\,P}(r,\pi/2,\phi)\propto A(\pi/2,\phi)=\cos\left[\frac{1}{2}(\xi+kd\cos\phi)\right] \quad{(77)}
$$
The $H$-plane pattern depends on the choices of the relative current phase, $\xi$, and the element spacing, $d$.

#### EXAMPLE 14.3

Investigate the $H$-plane pattern when the currents are in phase ($\xi=0$).

**Solution.** With $\xi=0$, Eq. (77) becomes
$$
A(\pi/2,\phi)=\cos\left[\frac{kd}{2}\cos\phi\right]=\cos\left[\frac{\pi d}{\lambda}\cos\phi\right]
$$
This reaches a maximum at $\phi=\pi/2$ and $3\pi/2$, or along the direction that is normal to the plane of the antennas (the $y$ axis). This occurs regardless of the choice of $d$, and the array is thus referred to as a $broadside$ array. Now, by choosing $d=\lambda/2$, we obtain $A=\cos[(\pi/2)\cos\phi]$, which becomes zero at $\phi=0$ and $\pi$ (along the $x$ axis), and we have single main beams along the positive and negative $y$ axis. When $d$ is increased beyond $\lambda/2$, additional maxima (sidelobes) appear as $\phi$ is varied, but zeros still occur along the $x$ axis if $d$ is set to odd multiples of $\lambda/2$.

The broadside array of the previous example can

[Truncated for analysis]

#### Page 553

This function maximizes at $\phi=0$ and reaches zero at $\phi=\pi$. We have thus created an array that radiates a _single_ main lobe along the positive $x$ axis. The way this works can be understood by realizing that the phase lag in current in the element at $x=d$ just compensates for the phase lag that arises from the propagation delay between the element at the origin and the one at $x=d$. The second element radiation is therefore precisely in phase with the radiation from the first element. The two fields, therefore, constructively interfere and propagate together in the forward $x$ direction. In the reverse direction, radiation from the antenna at $x=d$ arrives at the origin to find itself $\pi$ radians out of phase with the radiation from the $x=0$ element. The two fields therefore destructively interfere, and no radiation occurs in the negative $x$ direction.

D14.6. In the broadside configuration of Example 14.3, the element spacing is changed to $d=\lambda$. Determine $(a)$ the ratio of the emitted intensities in the $\phi=0$ and $\phi=90^{\circ}$ directions in the $H$ plane, $(b)$ the directions (values of $\phi$) of the main beams in the

[Truncated for analysis]

## Core Ideas

- In-phase excitation, $\xi=0$, produces a broadside array.
- Broadside maxima occur at $\phi=90^\circ$ and $270^\circ$ for any spacing.
- With $d=\lambda/2$, broadside-array zeros occur at $\phi=0$ and $180^\circ$.
- Increasing spacing beyond $\lambda/2$ introduces additional maxima.
- Endfire operation requires an array-factor maximum along the $x$ axis.
- The endfire condition is $\xi/2\pm\pi d/\lambda=m\pi$.
- The choice $d=\lambda/4$ and $\xi=-\pi/2$ gives a single beam toward positive $x$.
- Forward phase compensation and reverse phase opposition explain unidirectional endfire behavior.

## Source Anchors

- Example 14.3, Page 552 derives the broadside factor for $\xi=0$.
- For $d=\lambda/2$, Example 14.3 reports zeros at $\phi=0$ and $\pi$ and maxima along positive and negative $y$.
- Example 14.4 derives the endfire condition $\xi/2\pm\pi d/\lambda=m\pi$.
- The practical endfire choice is $m=0$, $d=\lambda/4$, and $\xi=-\pi/2$.
- The resulting factor is $A=\cos[(\pi/4)(\cos\phi-1)]$.
- Page 553 explains constructive interference in positive $x$ and destructive interference in negative $x$.
- Problems D14.6 and D14.7 test how spacing and wavelength changes alter beam and null directions.

## Related Pages

- [[two-element-array-far-zone-phase-geometry|Two-Element Array Far-Zone Phase Geometry]]
- [[pattern-multiplication-for-antenna-arrays|Pattern Multiplication for Antenna Arrays]]
- [[uniform-linear-array-beam-conditions|Uniform Linear Array Beam Conditions]]

## Concept Dependencies

- applies-to: [[pattern-multiplication-for-antenna-arrays|Pattern Multiplication for Antenna Arrays]]
- depends-on: [[two-element-array-far-zone-phase-geometry|Two-Element Array Far-Zone Phase Geometry]]
- example-of: [[uniform-linear-array-beam-conditions|Uniform Linear Array Beam Conditions]]
