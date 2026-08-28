---
title: "1.326 Pattern Multiplication for Antenna Arrays"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 551", "Page 552", "Section 14.5.2"]
related: ["two-element-array-far-zone-phase-geometry", "broadside-and-endfire-two-element-arrays", "uniform-linear-array-factor", "dipole-e-plane-pattern-function"]
---

# 1.326 Pattern Multiplication for Antenna Arrays

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 551, Page 552, Section 14.5.2

For two identical antennas, the summed field can be factored into the pattern of one element and an interference term determined by element position and excitation phase. Factoring $1+e^{j\psi}$ gives a magnitude proportional to $2|\cos(\psi/2)|$. The normalized array factor is therefore $A(\theta,\phi)=\cos[(\xi+kd\sin\theta\cos\phi)/2]$, while the total field magnitude is $|E_{\theta P}|=(2|E_0|/r)|F(\theta)||A(\theta,\phi)|$. This is the pattern multiplication principle: the total pattern is the product of an element factor and an array factor. The element factor primarily controls the E-plane dependence, while the array factor creates the strongest new control in the H plane. At $\theta=\pi/2$, the H-plane factor becomes $A(\pi/2,\phi)=\cos[(\xi+kd\cos\phi)/2]$. The method assumes that the antennas are essentially uncoupled. If mutual coupling induces appreciable currents between elements, the individual element currents no longer match the assumed excitations and simple pattern multiplication is invalid.

## Page-Grounded Details

#### Page 551

which simplifies to
$$
E_{\theta 	op P}(r,\theta,\phi)=\frac{E_{0}}{r}\frac{F(\theta)}{e^{-jkr}[1+e^{j\psi}]}\quad{(71)}
$$
where
$$
\psi=\xi+kd\,\sin\theta\cos\phi\quad{(72)}
$$
$\psi$ is the net phase difference between the two antenna fields that is observed at $P(r,\theta,\phi)$. Equation $(71)$ can be further simplified by factoring out the term $e^{j\psi/2}$ to obtain
$$
E_{\theta 	op P}(r,\theta,\phi)=\frac{2\,E_{0}}{r}\frac{F(\theta)}{e^{-jkr}e^{j\psi/2}\cos(\psi/2)}\quad{(73)}
$$
from which we may determine the field amplitude through
$$
|E_{\theta 	op P}(r,\theta,\phi)|=\sqrt{E_{\theta 	op P}E_{\theta 	op P}^{*}}=\frac{2\,E_{0}}{r}|F(\theta)|\|\cos(\psi/2)|\quad{(74)}
$$
#### 14.5.2 Pattern Multiplication Principle

Equation $(74)$ demonstrates the important principle of pattern multiplication that applies to arrays of identical antennas. Specifically, the total field magnitude consists of the product of the pattern function magnitude, or element factor for the individual antennas, $|F(\theta)|$, and the normalized array factor magnitude, given by $|\cos(\psi/2)|$. The array factor is often denoted by
$$
A(\theta,\phi)=\cos(\psi/2)=\cos\left[\frac{1

[Truncated for analysis]

#### Page 552
$$
 E_{\theta\,P}(r,\pi/2,\phi)\propto A(\pi/2,\phi)=\cos\left[\frac{1}{2}(\xi+kd\cos\phi)\right] \quad{(77)}
$$
The $H$-plane pattern depends on the choices of the relative current phase, $\xi$, and the element spacing, $d$.

#### EXAMPLE 14.3

Investigate the $H$-plane pattern when the currents are in phase ($\xi=0$).

**Solution.** With $\xi=0$, Eq. (77) becomes
$$
 A(\pi/2,\phi)=\cos\left[\frac{kd}{2}\cos\phi\right]=\cos\left[\frac{\pi d}{\lambda}\cos\phi\right] $$
This reaches a maximum at $\phi=\pi/2$ and $3\pi/2$, or along the direction that is normal to the plane of the antennas (the $y$ axis). This occurs regardless of the choice of $d$, and the array is thus referred to as a $broadside$ array. Now, by choosing $d=\lambda/2$, we obtain $A=\cos[(\pi/2)\cos\phi]$, which becomes zero at $\phi=0$ and $\pi$ (along the $x$ axis), and we have single main beams along the positive and negative $y$ axis. When $d$ is increased beyond $\lambda/2$, additional maxima (sidelobes) appear as $\phi$ is varied, but zeros still occur along the $x$ axis if $d$ is set to odd multiples of $\lambda/2$.

The broadside array of the previous example can

[Truncated for analysis]

## Core Ideas

- The normalized two-element array factor is $A(\theta,\phi)=\cos(\psi/2)$.
- The net phase is $\psi=\xi+kd\sin\theta\cos\phi$.
- The total magnitude is proportional to $|F(\theta)||A(\theta,\phi)|$.
- The individual antenna pattern $F(\theta)$ is the element factor.
- The array factor controls interference caused by spacing and current phase.
- The array has its strongest new directional control in the H plane.
- In the H plane, $A=\cos[(\xi+kd\cos\phi)/2]$.
- Pattern multiplication requires negligible mutual coupling between elements.

## Source Anchors

- Equations (73) and (74), Page 551 factor the two-element field and give its magnitude.
- Equation (75), Page 551 defines $A(\theta,\phi)=\cos[(\xi+kd\sin\theta\cos\phi)/2]$.
- Equation (76), Page 551 expresses the total field as the product of $|F|$ and $|A|$.
- Page 551 identifies $|F(\theta)|$ as the element factor and $|\cos(\psi/2)|$ as the normalized array factor.
- The source states that pattern multiplication assumes essentially uncoupled elements.
- Equation (77), Page 552 gives the H-plane dependence $A(\pi/2,\phi)=\cos[(\xi+kd\cos\phi)/2]$.

## Related Pages

- [[two-element-array-far-zone-phase-geometry|Two-Element Array Far-Zone Phase Geometry]]
- [[broadside-and-endfire-two-element-arrays|Broadside and Endfire Two-Element Arrays]]
- [[uniform-linear-array-factor|Uniform Linear Array Factor]]
- [[dipole-e-plane-pattern-function|Dipole E-Plane Pattern Function]]

## Concept Dependencies

- depends-on: [[dipole-e-plane-pattern-function|Dipole E-Plane Pattern Function]]
