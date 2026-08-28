---
title: "1.322 Half-Wave Dipole Pattern and Performance"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 546", "Page 547", "Section 14.4.4", "Example 14.2", "Figure 14.8a"]
related: ["standing-wave-current-on-a-finite-dipole", "dipole-e-plane-pattern-function", "half-wave-dipole-input-impedance-and-resonance", "monopole-antenna-and-image-theory"]
---

# 1.322 Half-Wave Dipole Pattern and Performance

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 546, Page 547, Section 14.4.4, Example 14.2, Figure 14.8a

A half-wave dipole has overall length $2\ell=\lambda/2$, so each arm has length $\ell=\lambda/4$ and $k\ell=\pi/2$. Substitution into the general dipole pattern eliminates the $\cos(k\ell)$ term and gives $F(\theta)=\cos[(\pi/2)\cos\theta]/\sin\theta$. The field is maximum broadside to the wire at $\theta=90^\circ$ and zero along its axis at $\theta=0$ and $180^\circ$. The half-power directions satisfy $F(\theta)=1/\sqrt{2}$ relative to the normalized maximum. Numerical solutions at $51^\circ$ and $129^\circ$ give a half-power beamwidth of $78^\circ$. Numerical integration of the pattern yields maximum directivity $D_{\max}=1.64$, equivalent to 2.15 dB, and radiation resistance $R_{\mathrm{rad}}=73\ \Omega$. The standing-wave current reaches its maximum at the feed, which places the antenna near resonance. These pattern and impedance values make the half-wave dipole a practical compromise between useful directivity, single-lobe behavior, and compatibility with conventional transmission-line impedances.

## Page-Grounded Details

#### Page 546

Using this result, expressions for the directivity and radiation resistance can now be found. From Eq. (42), and using (60) and (62), the directivity in free space is
$$
D(\theta)=\frac{4\pi\,K(\theta)}{P_{r}}=\frac{2\left[F(\theta)\right]^{2}}{\int_{0}^{\pi}[F(\theta)]^{2}\,\sin\theta\,d\theta}\quad{(63)}
$$
whose maximum value is
$$
D_{\max}=\frac{2\left[F(\theta)\right]_{\max}^{2}}{\int_{0}^{\pi}[F(\theta)]^{2}\,\sin\theta\,d\theta}\quad{(64)}
$$
Finally, the radiation resistance will be
$$
R_{\mathrm{rad}}=\frac{2P_{r}}{I_{0}^{2}}=60\int_{0}^{\pi}[F(\theta)]^{2}\,\sin\theta\,d\theta\quad{(65)}
$$
D14.4. Evaluate the percentage of the maximum power density that is found in the direction $\theta=45^{\circ}$ for dipole antennas of overall length (a) $\lambda/4$, (b) $\lambda/2$, (c) $\lambda$.

Ans. (a) 45.7%; (b) 38.6%; (c) 3.7%

#### 14.4.4 Half-Wave Dipole

When the antenna length is chosen to be $2\ell=\lambda/2$, we form a "half-wave" dipole; this length choice has several advantages in practice. We begin with an example:

#### EXAMPLE 14.2

Write the specific pattern function, and evaluate the beamwidth, directivity, and radiation resistance of a half-wave di

[Truncated for analysis]

#### Page 547

In the half-wave dipole, the standing wave current amplitude maximizes at the feed point, and the antenna is said to be operated on resonance. As a result, the driving point impedance, one-quarter wavelength in front of the open ends, would in principle be purely real$^{4}$ and equal to the 73-Ω radiation resistance, assuming that the antenna is otherwise lossless. This is the primary motivation for using half-wave dipoles, in that they provide a fairly close impedance match to conventional transmission lines (whose characteristic impedances are on the same order).

Actually, because the antenna is essentially an unfolded transmission line, the half-wave dipole does not behave as an ideal quarter-wave transmission line section, as we might suspect considering the discussions in Section 14.1. An appreciable reactive part of the input impedance will likely be present, but the half-wavelength dimension is very close to the length at which the reactance goes to zero. Methods of evaluating the reactance are beyond the scope of our treatment, but are considered in detail in Ref. 1. For a thin lossless dipole of length exactly $\lambda/2$, the input impedance would be $ Z_{\rm in}=73+

[Truncated for analysis]

## Core Ideas

- A half-wave dipole has $2\ell=\lambda/2$ and $k\ell=\pi/2$.
- Its pattern is $F(\theta)=\cos[(\pi/2)\cos\theta]/\sin\theta$.
- Pattern maxima occur broadside at $\theta=90^\circ$.
- Pattern zeros occur along the antenna axis at $\theta=0$ and $180^\circ$.
- The half-power angles are $51^\circ$ and $129^\circ$.
- The half-power beamwidth is $78^\circ$.
- The maximum directivity is 1.64, or 2.15 dB.
- The radiation resistance is approximately $73\ \Omega$.

## Source Anchors

- Equation (66), Page 546 gives the half-wave pattern function.
- Example 14.2 identifies maxima at $\theta=\pi/2$ and zeros at $\theta=0$ and $\pi$.
- Example 14.2 solves the half-power equation numerically at $51^\circ$ and $129^\circ$.
- The calculated half-power beamwidth is $129^\circ-51^\circ=78^\circ$.
- The example reports $D_{\max}=1.64$, or 2.15 dB.
- The example reports $R_{\mathrm{rad}}=73\ \Omega$.
- Figure S26.P545.F14.8 includes the normalized half-wave pattern as the dashed curve.

## Related Pages

- [[standing-wave-current-on-a-finite-dipole|Standing-Wave Current on a Finite Dipole]]
- [[dipole-e-plane-pattern-function|Dipole E-Plane Pattern Function]]
- [[half-wave-dipole-input-impedance-and-resonance|Half-Wave Dipole Input Impedance and Resonance]]
- [[monopole-antenna-and-image-theory|Monopole Antenna and Image Theory]]

## Concept Dependencies

- example-of: [[dipole-e-plane-pattern-function|Dipole E-Plane Pattern Function]]
- related: [[half-wave-dipole-input-impedance-and-resonance|Half-Wave Dipole Input Impedance and Resonance]]
