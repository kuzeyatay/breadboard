---
title: "Uniform Linear Array Beam Conditions"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "uniform-linear-array-beam-conditions"
locations: ["Page 555", "Page 556", "Page 557", "Section 14.6.2", "Example 14.5", "Figure 14.14", "Figure 14.15", "Problem D14.8", "Problem D14.9"]
related: ["uniform-linear-array-factor", "broadside-and-endfire-two-element-arrays", "pattern-multiplication-for-antenna-arrays"]
---

## ConceptNode: Uniform Linear Array Beam Conditions

Planning node for [[uniform-linear-array-beam-conditions|1.329 Uniform Linear Array Beam Conditions]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 555, Page 556, Page 557, Section 14.6.2, Example 14.5, Figure 14.14, Figure 14.15, Problem D14.8, Problem D14.9

The uniform-array factor has principal maxima when $\psi=2m\pi$, where $m$ is any integer. These maxima define the main-beam directions after the physically available range of $\psi$ is mapped to observation angles. In the H plane, $\theta=\pi/2$ and $\psi=\xi+kd\cos\phi$. Since $-1\le\cos\phi\le1$, the accessible interval is $\xi-kd\le\psi\le\xi+kd$. The phase progression $\xi$ fixes the center of this interval, while spacing $d$ controls its width. For broadside operation, a principal maximum is required at $\phi=90^\circ$, giving $\xi=0$. Increasing spacing then narrows the main beam but exposes more of the periodic array-factor curve, producing more sidelobes. For positive-$x$ endfire operation, requiring $\psi=0$ at $\phi=0$ gives $\xi=-kd$. More generally, a desired main-beam direction satisfies $\cos\phi_{\max}=-\xi/(kd)$. Increasing the element count narrows the main lobe but also increases the number of sidelobes represented within the available phase interval.

### Key planning details

- Principal array-factor maxima occur at $\psi=2m\pi$.
- In the H plane, $\psi=\xi+kd\cos\phi$.
- The accessible phase range is $\xi-kd\le\psi\le\xi+kd$.
- The progressive phase $\xi$ sets the center of the accessible range.
- The spacing $d$ sets the angular phase variation around that center.
- Broadside operation uses $\xi=0$.
- Positive-$x$ endfire operation uses $\xi=-kd$.
- A steerable main beam satisfies $\cos\phi_{\max}=-\xi/(kd)$.
- More elements narrow the main beam and increase sidelobe count.

### Source coverage

- Figure S26.P555.F14.14 plots $|A_n(\psi)|$ for $n=4$ and $n=8$ over $-2\pi<\psi<2\pi$.
- Page 555 states that principal maxima occur at $\psi=2m\pi$.
- Equation (83), Page 555 gives $\xi-kd\le\psi\le\xi+kd$.
- Page 555 derives $\xi=0$ as the broadside condition.
- Page 556 derives $\xi=-kd$ for a positive-$x$ endfire maximum.
- Example 14.5 chooses $\xi=-\pi/2$ and $d=\lambda/4$ to create unidirectional endfire patterns for 4 and 8 elements.
- Figure S26.P556.F14.15 shows that increasing from 4 to 8 elements narrows the main beam and increases sidelobes from one to three.
- Problems D14.8 and D14.9 apply the endfire and beam-steering conditions.
