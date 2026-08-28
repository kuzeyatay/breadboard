---
title: "1.325 Two-Element Array Far-Zone Phase Geometry"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 549", "Page 550", "Page 551", "Section 14.5", "Section 14.5.1", "Figure 14.11", "Figure 14.12"]
related: ["pattern-multiplication-for-antenna-arrays", "broadside-and-endfire-two-element-arrays", "uniform-linear-array-factor"]
---

# 1.325 Two-Element Array Far-Zone Phase Geometry

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 549, Page 550, Page 551, Section 14.5, Section 14.5.1, Figure 14.11, Figure 14.12

A two-element array extends directional control beyond what is possible with a single vertical wire. The source places two identical $z$-directed antennas along the $x$ axis, separated by distance $d$. Both carry current amplitude $I_0$, while the second has a fixed current phase shift $\xi$. At a far-zone point $(r,\theta,\phi)$, the rays from the two elements are approximately parallel and their electric fields share the $\mathbf a_\theta$ direction. The second path length is found by projecting the separation vector onto the radial direction. This projection is $s=d\mathbf a_x\cdot\mathbf a_r=d\sin\theta\cos\phi$, giving $r_1\simeq r-d\sin\theta\cos\phi$. As in the finite-dipole derivation, the small path difference is ignored in the amplitude denominator but retained in phase. Combining the imposed current phase with the propagation phase produces the net observed phase difference $\psi=\xi+kd\sin\theta\cos\phi$. This phase controls constructive and destructive interference as a function of observation direction.

## Page-Grounded Details

#### Page 549

D14.5. The monopole antenna of Figure 14.10$a$ has a length $d/2=0.080$ m and may be assumed to carry a triangular current distribution for which the feed current $I_{0}$ is 16.0 A at a frequency of 375 MHz in free space. At point $P$ ($r=400$ m, $\theta=60^{\circ}$, $\phi=45^{\circ}$) find (a) $H_{\phi s}$, (b) $E_{\theta s}$, and (c) the amplitude of $\mathcal{P}_{r}$.

Ans. (a) j1.7 mA/m; (b) j0.65 V/m; (c) 1.1 W/m^2

#### 14.5 Arrays of Two Elements

We next address the problem of establishing better control of the directional properties of antenna radiation. Although some control of directivity is achieved through adjustment of the length of a wire antenna, these results only appear as changes in the $E$-plane pattern. The $H$-plane pattern always remains a circle (no $\phi$ variation), as long as a single vertical wire antenna is used. By using multiple elements in an array, significant improvement in directivity as determined in both $E$ and $H$ planes can be achieved. Our objective in this section is to lay the groundwork for the analysis of arrays by considering the simple case of using two elements. The resulting methods are readily extendabl

[Truncated for analysis]

#### Page 550

Figure 14.12 Top view of the arrangement of Figure 14.11 (looking down onto the x-y plane). In the far-field approximation, the blue lines are essentially parallel, and $r_{1} \doteq r - s$.

are essentially parallel, and (2) the electric field directions at $P$ are essentially the same (along $\mathbf{a}_{\theta}$). Using Eq. (57), we may therefore write the total field at $P$, with the understanding that the presence of the second antenna on the $x$ axis will introduce a $\phi$ dependence in the field that was previously not present:
$$
E_{\theta\,P}(r,\theta,\phi)=E_{0}\,\,F(\theta)\left[\frac{e^{-jkr}}{r}+\frac{e^{j\xi}e^{-jkr_{1}}}{r_{1}}\right] (67)
$$
Next, we may express the distance to $P$ from the second antenna, $r_{1}$, in terms of the distance to the first antenna, $r$ (also the spherical coordinate radius), by noting that in the far-field approximation we have
$$
r_{1}\doteq r-s
$$
where $s$ is one leg of the right triangle formed by drawing a perpendicular line segment between the second antenna and the line of radius $r$ as shown in Figures 14.11 and 14.12. The length, $s$, is the projection of the antenna separation, $d$, onto the radi

[Truncated for analysis]

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
$$ A(\theta,\phi)=\cos(\psi/2)=\cos\left[\frac{1

[Truncated for analysis]

## Core Ideas

- The array contains two identical parallel antennas separated by $d$ along the $x$ axis.
- The second antenna current has phase shift $\xi$ relative to the first.
- Far-zone rays from the two antennas are treated as parallel.
- The separation projection is $s=d\sin\theta\cos\phi$.
- The second path length is $r_1\simeq r-d\sin\theta\cos\phi$.
- Path differences are neglected in amplitude but retained in phase.
- The observed phase difference is $\psi=\xi+kd\sin\theta\cos\phi$.
- The displaced element introduces $\phi$ dependence that a single vertical dipole lacks.

## Source Anchors

- Figure S26.P549.F14.11 shows two parallel $z$-directed antennas separated by $d$ along $x$, with relative current phase $\xi$.
- Figure S26.P550.F14.12 gives the top-view far-field geometry and the approximation $r_1\simeq r-s$.
- Equation (67), Page 550 sums the two individual antenna fields.
- Equation (68), Page 550 gives $s=d\sin\theta\cos\phi$.
- Equation (69), Page 550 gives $r_1\simeq r-d\sin\theta\cos\phi$.
- Equation (72), Page 551 defines $\psi=\xi+kd\sin\theta\cos\phi$.

## Related Pages

- [[pattern-multiplication-for-antenna-arrays|Pattern Multiplication for Antenna Arrays]]
- [[broadside-and-endfire-two-element-arrays|Broadside and Endfire Two-Element Arrays]]
- [[uniform-linear-array-factor|Uniform Linear Array Factor]]

## Concept Dependencies

- enables: [[pattern-multiplication-for-antenna-arrays|Pattern Multiplication for Antenna Arrays]]
