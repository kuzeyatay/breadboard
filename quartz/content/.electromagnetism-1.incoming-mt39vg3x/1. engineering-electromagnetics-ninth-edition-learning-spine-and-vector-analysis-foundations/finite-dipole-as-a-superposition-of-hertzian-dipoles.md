---
title: "1.318 Finite Dipole as a Superposition of Hertzian Dipoles"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 542", "Page 543", "Section 14.4.2", "Figure 14.7"]
related: ["standing-wave-current-on-a-finite-dipole", "parity-based-evaluation-of-the-dipole-field-integral", "dipole-e-plane-pattern-function"]
---

# 1.318 Finite Dipole as a Superposition of Hertzian Dipoles

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 542, Page 543, Section 14.4.2, Figure 14.7

The field of a finite wire dipole is derived by dividing the antenna into differential Hertzian dipoles of length $dz$. Each differential element carries the local current $I_s(z)$ prescribed by the standing-wave distribution. Its far-zone contribution is $dE_{\theta s}=j[I_s(z)k\eta\sin\theta'/(4\pi r')]e^{-jkr'}dz$. Because each element has a different origin, its local distance $r'$ and angle $\theta'$ must be related to coordinates measured from the antenna feed. In the far zone, the observation lines are approximately parallel, giving $r'\simeq r-z\cos\theta$ and $\theta'\simeq\theta$. The small difference between $r'$ and $r$ is neglected in the slowly varying amplitude denominator, but it is retained in the exponential phase. This distinction is essential because a small path-length change has little effect on $1/r$ but can significantly alter the phase $kr'$. Integrating the phase-adjusted differential fields from $-\ell$ to $+\ell$ produces the complete finite-dipole far field.

## Page-Grounded Details

#### Page 542

On a short antenna, where $2\mathscr{C}$ is significantly less than a half-wavelength, we see only the first portion of the sine wave; the amplitude of the current increases in an approximately linear manner, from zero at the ends to a maximum value at the feed, as indicated in Figure 14.6. The gap at the feed point is small and has negligible effects. The short antenna approximation (in which a linear current variation along the length can be assumed) is reasonable for antennas having an overall length that is less than about one-tenth of a wavelength.

A simple extension of the Hertzian dipole results can be performed in the short antenna regime ($\mathscr{C}<\lambda/20$). If this is the case, then retardation effects may be neglected. That is, signals arriving at any field point $P$ from the two ends of the antenna are approximately in phase. The average current along the antenna is $I_{0}/2$, where $I_{0}$ is the input current at the feed. The electric and magnetic field intensities will thus be one-half the values given in (22) and (23), and there are no changes in the vertical and horizontal patterns. The power will be one-quarter of its previous value, and thus the

[Truncated for analysis]

#### Page 543

Figure 14.7 A dipole antenna can be represented as a stack of Hertzian dipoles whose individual phasor currents are given by $I_{s}(z)$. One Hertzian dipole is shown at location $z$, and has length $dz$. When the observation point, $P$, lies in the far zone, distance lines $r$ and $r^{\prime}$ are approximately parallel, so they differ in length by $z\cos\theta$.

distance $r^{\prime}$ from the Hertzian at location $z$ and the distance $r$ from the origin to the same point as
$$
r^{\prime}\doteq r-z\cos\theta\quad{(54)}
$$
where, in the far field, $\theta^{\prime}\doteq\theta$, and distance lines $r^{\prime}$ and $r$ are approximately parallel. Eq. (53) is then modified to read
$$
d\,E_{\theta s}=j\frac{I_{s}(z)k\,dz}{4\pi r}\eta\,\sin\theta\,e^{-jk(r-z\cos\theta)}\quad{(55)}
$$
Notice that in obtaining (55) from (53) we have approximated $r^{\prime}\doteq r$ in the denominator, as the use of Eq. (54) will make little difference when considering amplitude variations with $z$ and $\theta$. The exponential term in (55) does include (54) because slight variations in $z$ or $\theta$ will greatly affect the phase.

Now, the total electric field at

[Truncated for analysis]

## Core Ideas

- The finite antenna is decomposed into differential Hertzian dipoles of length $dz$.
- Each differential element carries the position-dependent current $I_s(z)$.
- The local far field contains both the element factor $\sin\theta'$ and propagation phase $e^{-jkr'}$.
- Far-zone geometry gives $r'\simeq r-z\cos\theta$ and $\theta'\simeq\theta$.
- The approximation $r'\simeq r$ is used in the amplitude denominator.
- The path correction $-z\cos\theta$ must remain in the phase.
- The total field is the integral of all differential contributions over the wire.

## Source Anchors

- Figure S26.P543.F14.7 depicts the dipole as a stack of Hertzian dipoles, including one element at coordinate $z$ with length $dz$.
- Equation (53), Page 542: $dE_{\theta s}=j\frac{I_s(z)k\,dz}{4\pi r'}\eta\sin\theta' e^{-jkr'}$.
- Equation (54), Page 543: $r'\simeq r-z\cos\theta$.
- Equation (55), Page 543 retains the path correction in $e^{-jk(r-z\cos\theta)}$ while replacing $r'$ by $r$ in the denominator.
- Equation (56), Page 543 integrates contributions over $-\ell\le z\le\ell$.
- The Figure 14.7 caption states that $r$ and $r'$ are approximately parallel in the far zone and differ by $z\cos\theta$.

## Related Pages

- [[standing-wave-current-on-a-finite-dipole|Standing-Wave Current on a Finite Dipole]]
- [[parity-based-evaluation-of-the-dipole-field-integral|Parity-Based Evaluation of the Dipole Field Integral]]
- [[dipole-e-plane-pattern-function|Dipole E-Plane Pattern Function]]

## Concept Dependencies

- enables: [[parity-based-evaluation-of-the-dipole-field-integral|Parity-Based Evaluation of the Dipole Field Integral]]
