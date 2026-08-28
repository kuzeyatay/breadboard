---
title: "1.329 Uniform Linear Array Beam Conditions"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 555", "Page 556", "Page 557", "Section 14.6.2", "Example 14.5", "Figure 14.14", "Figure 14.15", "Problem D14.8", "Problem D14.9"]
related: ["uniform-linear-array-factor", "broadside-and-endfire-two-element-arrays", "pattern-multiplication-for-antenna-arrays"]
---

# 1.329 Uniform Linear Array Beam Conditions

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 555, Page 556, Page 557, Section 14.6.2, Example 14.5, Figure 14.14, Figure 14.15, Problem D14.8, Problem D14.9

The uniform-array factor has principal maxima when $\psi=2m\pi$, where $m$ is any integer. These maxima define the main-beam directions after the physically available range of $\psi$ is mapped to observation angles. In the H plane, $\theta=\pi/2$ and $\psi=\xi+kd\cos\phi$. Since $-1\le\cos\phi\le1$, the accessible interval is $\xi-kd\le\psi\le\xi+kd$. The phase progression $\xi$ fixes the center of this interval, while spacing $d$ controls its width. For broadside operation, a principal maximum is required at $\phi=90^\circ$, giving $\xi=0$. Increasing spacing then narrows the main beam but exposes more of the periodic array-factor curve, producing more sidelobes. For positive-$x$ endfire operation, requiring $\psi=0$ at $\phi=0$ gives $\xi=-kd$. More generally, a desired main-beam direction satisfies $\cos\phi_{\max}=-\xi/(kd)$. Increasing the element count narrows the main lobe but also increases the number of sidelobes represented within the available phase interval.

## Page-Grounded Details

#### Page 555

Figure 14.14 $|A_{n}(\psi)|$ as evaluated from Eq. (81) over the range $-2\pi<\psi<2\pi$ for cases in which the number of elements, $n$, is ($\alpha$) 4, and ($b$) 8.

#### 14.6.2 Special Cases

Plots of Eq. (81) are shown in Figure 14.14 for the cases in which $n=4$ and $n=8$. Note that the functions always maximize to unity when $\psi=2m\pi$, where $m$ is an integer that includes zero. These principal maxima correspond to the main beams of the array pattern. The effect of increasing the number of elements is to narrow the main lobes and to bring in more secondary maxima (sidelobes).

To see how the array pattern is shaped, it is necessary to interpret the array function, Eq. (81), with regard to angular variation in the $H$ plane. In this plane (where $\theta=\pi/2$), we have $\psi=\xi+kd\cos\phi$. Then, knowing that $\phi$ varies from 0 to $2\pi$ radians, $\cos\phi$ varies between $\pm 1$, and we can see that $\psi$ will be within the range
$$
\xi-kd\leq\psi\leq\xi+kd\quad{(83)}
$$
Choices of the current phasing $\xi$ and the antenna spacing $d$ determine the range of $\psi$ values that will appear in the actual array pattern. This could

[Truncated for analysis]

#### Page 556

An endfire array requires a principal maximum to occur along the $x$ axis. In the $H$ plane, we may therefore write
$$
\psi=0=\xi+kd\cos(0)=\xi+kd
$$
or $\xi=-kd$ to obtain endfire operation with a maximum occurring along the positive $x$ axis. This may or may not result in a main beam occurring along the negative $x$ axis as well.

#### EXAMPLE 14.5

For arrays of 4 and 8 elements, select the current phase and element spacing that will give unidirectional endfire operation, in which the main beam exists in the $\phi=0$ direction, whereas no radiation occurs in the direction of $\phi=\pi$, nor in the broadside directions ($\phi=\pm\pi/2$).

**Solution.** We want $\psi=0$ when $\phi=0$. Therefore, from $\psi=\xi+kd\cos\phi$, we would require that $0=\xi+kd$, or that $\xi=-kd$. Using 4 or 8 elements, we find either from Eq. (81) or from Figure 14.14 that zeros will occur when $\psi=\pm\pi/2$ and $\pm\pi$. Therefore, if we choose $\xi=-\pi/2$ and $d=\lambda/4$, we obtain $\psi=-\pi/2$ at $\phi=\pi/2$, $3\pi/2$, and $\psi=-\pi$ at $\phi=\pi$. We thus have $\psi=-(\pi/2)(1-\cos\phi)$. Polar plots of the resulting array functions are shown

[Truncated for analysis]

#### Page 557

D14.8. In an endfire linear dipole array in which $\xi=-kd$, what minimum element spacing $d$ in wavelengths results in bidirectional operation, in which equal intensities occur in the $H$ plane at $\phi=0$ and $\phi=\pi$?

Ans. $d=\lambda/2$

D14.9. For a linear dipole array in which the element spacing is $d=\lambda/4$, what current phase $\xi$ will result in a main beam in the direction of (a) $\phi=30^{\circ}$; (b) $\phi=45^{\circ}$?

Ans. (a) $-\pi\sqrt{3}/4$; (b) $-\pi\sqrt{2}/4$

#### 14.7 ANTENNAS AS RECEIVERS

We next turn to the other fundamental purpose of an antenna, which is its use as a means to detect, or receive, radiation that originates from a distant source. We will approach this problem through study of a transmit-receive antenna system. This is composed of two antennas, along with their supporting electronics, that play the interchangeable roles of transmitter and detector.

#### 14.7.1 Transmit-Receive Link as a Two-Port Network: Reciprocity

Figure 14.16 shows an example of a transmit-receive arrangement, in which the two coupled antennas together comprise a linear two-port network. Voltage $V_{1}$ and current $I_{1}$ on the antenn

[Truncated for analysis]

## Core Ideas

- Principal array-factor maxima occur at $\psi=2m\pi$.
- In the H plane, $\psi=\xi+kd\cos\phi$.
- The accessible phase range is $\xi-kd\le\psi\le\xi+kd$.
- The progressive phase $\xi$ sets the center of the accessible range.
- The spacing $d$ sets the angular phase variation around that center.
- Broadside operation uses $\xi=0$.
- Positive-$x$ endfire operation uses $\xi=-kd$.
- A steerable main beam satisfies $\cos\phi_{\max}=-\xi/(kd)$.
- More elements narrow the main beam and increase sidelobe count.

## Source Anchors

- Figure S26.P555.F14.14 plots $|A_n(\psi)|$ for $n=4$ and $n=8$ over $-2\pi<\psi<2\pi$.
- Page 555 states that principal maxima occur at $\psi=2m\pi$.
- Equation (83), Page 555 gives $\xi-kd\le\psi\le\xi+kd$.
- Page 555 derives $\xi=0$ as the broadside condition.
- Page 556 derives $\xi=-kd$ for a positive-$x$ endfire maximum.
- Example 14.5 chooses $\xi=-\pi/2$ and $d=\lambda/4$ to create unidirectional endfire patterns for 4 and 8 elements.
- Figure S26.P556.F14.15 shows that increasing from 4 to 8 elements narrows the main beam and increases sidelobes from one to three.
- Problems D14.8 and D14.9 apply the endfire and beam-steering conditions.

## Related Pages

- [[uniform-linear-array-factor|Uniform Linear Array Factor]]
- [[broadside-and-endfire-two-element-arrays|Broadside and Endfire Two-Element Arrays]]
- [[pattern-multiplication-for-antenna-arrays|Pattern Multiplication for Antenna Arrays]]

## Concept Dependencies

- depends-on: [[uniform-linear-array-factor|Uniform Linear Array Factor]]
- related: [[broadside-and-endfire-two-element-arrays|Broadside and Endfire Two-Element Arrays]]
