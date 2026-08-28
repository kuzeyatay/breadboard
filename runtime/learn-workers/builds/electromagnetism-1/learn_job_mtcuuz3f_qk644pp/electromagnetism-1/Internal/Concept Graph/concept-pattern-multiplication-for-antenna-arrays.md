---
title: "Pattern Multiplication for Antenna Arrays"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "pattern-multiplication-for-antenna-arrays"
locations: ["Page 551", "Page 552", "Section 14.5.2"]
related: ["two-element-array-far-zone-phase-geometry", "broadside-and-endfire-two-element-arrays", "uniform-linear-array-factor", "dipole-e-plane-pattern-function"]
---

## ConceptNode: Pattern Multiplication for Antenna Arrays

Planning node for [[pattern-multiplication-for-antenna-arrays|1.326 Pattern Multiplication for Antenna Arrays]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 551, Page 552, Section 14.5.2

For two identical antennas, the summed field can be factored into the pattern of one element and an interference term determined by element position and excitation phase. Factoring $1+e^{j\psi}$ gives a magnitude proportional to $2|\cos(\psi/2)|$. The normalized array factor is therefore $A(\theta,\phi)=\cos[(\xi+kd\sin\theta\cos\phi)/2]$, while the total field magnitude is $|E_{\theta P}|=(2|E_0|/r)|F(\theta)||A(\theta,\phi)|$. This is the pattern multiplication principle: the total pattern is the product of an element factor and an array factor. The element factor primarily controls the E-plane dependence, while the array factor creates the strongest new control in the H plane. At $\theta=\pi/2$, the H-plane factor becomes $A(\pi/2,\phi)=\cos[(\xi+kd\cos\phi)/2]$. The method assumes that the antennas are essentially uncoupled. If mutual coupling induces appreciable currents between elements, the individual element currents no longer match the assumed excitations and simple pattern multiplication is invalid.

### Key planning details

- The normalized two-element array factor is $A(\theta,\phi)=\cos(\psi/2)$.
- The net phase is $\psi=\xi+kd\sin\theta\cos\phi$.
- The total magnitude is proportional to $|F(\theta)||A(\theta,\phi)|$.
- The individual antenna pattern $F(\theta)$ is the element factor.
- The array factor controls interference caused by spacing and current phase.
- The array has its strongest new directional control in the H plane.
- In the H plane, $A=\cos[(\xi+kd\cos\phi)/2]$.
- Pattern multiplication requires negligible mutual coupling between elements.

### Source coverage

- Equations (73) and (74), Page 551 factor the two-element field and give its magnitude.
- Equation (75), Page 551 defines $A(\theta,\phi)=\cos[(\xi+kd\sin\theta\cos\phi)/2]$.
- Equation (76), Page 551 expresses the total field as the product of $|F|$ and $|A|$.
- Page 551 identifies $|F(\theta)|$ as the element factor and $|\cos(\psi/2)|$ as the normalized array factor.
- The source states that pattern multiplication assumes essentially uncoupled elements.
- Equation (77), Page 552 gives the H-plane dependence $A(\pi/2,\phi)=\cos[(\xi+kd\cos\phi)/2]$.
