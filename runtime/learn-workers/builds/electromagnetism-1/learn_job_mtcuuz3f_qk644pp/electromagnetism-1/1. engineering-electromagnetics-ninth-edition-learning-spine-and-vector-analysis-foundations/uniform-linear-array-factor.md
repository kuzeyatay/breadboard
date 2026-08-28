---
title: "1.328 Uniform Linear Array Factor"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 553", "Page 554", "Section 14.6", "Section 14.6.1", "Figure 14.13"]
related: ["pattern-multiplication-for-antenna-arrays", "uniform-linear-array-beam-conditions", "broadside-and-endfire-two-element-arrays", "two-element-array-far-zone-phase-geometry"]
---

# 1.328 Uniform Linear Array Factor

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 553, Page 554, Section 14.6, Section 14.6.1, Figure 14.13

A uniform linear array contains $n$ identical elements placed along a straight line with equal spacing $d$, equal current amplitudes $I_0$, and constant phase progression $\xi$ between adjacent elements. For the geometry used in the source, the elements lie along $x$ and each dipole is oriented along $z$. The phase increment observed at a far-zone point remains $\psi=\xi+kd\sin\theta\cos\phi$. Normalizing by the number of elements gives the array factor as the magnitude of a geometric series: $|A_n|=(1/n)|1+e^{j\psi}+\cdots+e^{j(n-1)\psi}|$. Summing the series and applying Euler identities produces the closed form $|A_n(\psi)|=(1/n)|\sin(n\psi/2)/\sin(\psi/2)|$. The complete far-zone field again follows pattern multiplication: $|E_{\theta P}|=(n|E_0|/r)|F(\theta)||A_n(\theta,\phi)|$. The normalization makes the principal maximum of the array factor equal to one, while the explicit factor $n$ accounts for coherent addition of the element fields.

## Page-Grounded Details

#### Page 553

This function maximizes at $\phi=0$ and reaches zero at $\phi=\pi$. We have thus created an array that radiates a _single_ main lobe along the positive $x$ axis. The way this works can be understood by realizing that the phase lag in current in the element at $x=d$ just compensates for the phase lag that arises from the propagation delay between the element at the origin and the one at $x=d$. The second element radiation is therefore precisely in phase with the radiation from the first element. The two fields, therefore, constructively interfere and propagate together in the forward $x$ direction. In the reverse direction, radiation from the antenna at $x=d$ arrives at the origin to find itself $\pi$ radians out of phase with the radiation from the $x=0$ element. The two fields therefore destructively interfere, and no radiation occurs in the negative $x$ direction.

D14.6. In the broadside configuration of Example 14.3, the element spacing is changed to $d=\lambda$. Determine $(a)$ the ratio of the emitted intensities in the $\phi=0$ and $\phi=90^{\circ}$ directions in the $H$ plane, $(b)$ the directions (values of $\phi$) of the main beams in the

[Truncated for analysis]

#### Page 554

Figure 14.13 H-plane diagram of a uniform linear array of $n$ dipoles, arranged along $x$, and with individual dipoles oriented along $z$ (out of the page). All elements have equal spacing, $d$, and carry equal current amplitudes, $I_{0}$. Current phase shift $\xi$ occurs between adjacent elements. Fields are evaluated at far-zone point $P$, from which the dipoles appear to be grouped at the origin.

where the subscript 2 is applied to $A$ to indicate that the function applies to two ele-ments. The array factor for a linear array of $n$ elements as depicted in Figure 14.13 is a direct extension of (78) and becomes
$$
|A_{n}(\theta,\phi)|=|A_{n}(\psi)|=\frac{1}{n}|1+e^{j\psi}+e^{j2\psi}+e^{j3\psi}+e^{4\psi}+\ldots+e^{j(n-1)\psi}|(79)
$$
With the elements arranged along the $x$ axis as shown in Figure 14.13, we have $\psi=\xi+kd\sin\theta\cos\phi$, as before. The geometric progression that comprises Eq. (79) can be expressed in closed form to give
$$
|A_{n}(\psi)|=\frac{1}{n}\frac{|1-e^{jn\psi}|}{|1-e^{j\psi}|}=\frac{1}{n}\frac{|e^{jn\psi/2}(e^{-jn\psi/2}-e^{jn\psi/2})|}{|e^{j\psi/2}(e^{-j\psi/2}-e^{j\psi/2})|}(80)
$$
In the far right side of Eq. (80), we re

[Truncated for analysis]

## Core Ideas

- A uniform linear array has identical elements, equal spacing, equal current amplitudes, and constant phase progression.
- For an $x$-directed array, $\psi=\xi+kd\sin\theta\cos\phi$.
- The normalized factor is a geometric sum of $n$ phasors.
- The series form is $|A_n|=(1/n)|\sum_{q=0}^{n-1}e^{jq\psi}|$.
- The closed form is $|A_n|=(1/n)|\sin(n\psi/2)/\sin(\psi/2)|$.
- The total field magnitude is $(n|E_0|/r)|F||A_n|$.
- The result extends pattern multiplication from two elements to $n$ elements.

## Source Anchors

- Figure S26.P554.F14.13 shows $n$ dipoles arranged along $x$, oriented along $z$, with spacing $d$ and phase shift $\xi$.
- Equation (78), Page 553 expresses the two-element normalized factor as $(1/2)|1+e^{j\psi}|$.
- Equation (79), Page 554 extends the phasor sum to $n$ elements.
- Equation (80), Page 554 evaluates the geometric progression in closed form.
- Equation (81), Page 554 gives $|A_n|=(1/n)|\sin(n\psi/2)/\sin(\psi/2)|$.
- Equation (82), Page 554 gives the array far-field magnitude using pattern multiplication.

## Related Pages

- [[pattern-multiplication-for-antenna-arrays|Pattern Multiplication for Antenna Arrays]]
- [[uniform-linear-array-beam-conditions|Uniform Linear Array Beam Conditions]]
- [[broadside-and-endfire-two-element-arrays|Broadside and Endfire Two-Element Arrays]]
- [[two-element-array-far-zone-phase-geometry|Two-Element Array Far-Zone Phase Geometry]]

## Concept Dependencies

- derives-from: [[pattern-multiplication-for-antenna-arrays|Pattern Multiplication for Antenna Arrays]]
- depends-on: [[two-element-array-far-zone-phase-geometry|Two-Element Array Far-Zone Phase Geometry]]
