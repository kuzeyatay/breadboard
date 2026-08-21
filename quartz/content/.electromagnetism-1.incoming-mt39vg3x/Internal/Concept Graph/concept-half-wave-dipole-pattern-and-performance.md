---
title: "Half-Wave Dipole Pattern and Performance"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "half-wave-dipole-pattern-and-performance"
locations: ["Page 546", "Page 547", "Section 14.4.4", "Example 14.2", "Figure 14.8a"]
related: ["standing-wave-current-on-a-finite-dipole", "dipole-e-plane-pattern-function", "half-wave-dipole-input-impedance-and-resonance", "monopole-antenna-and-image-theory"]
---

## ConceptNode: Half-Wave Dipole Pattern and Performance

Planning node for [[half-wave-dipole-pattern-and-performance|1.322 Half-Wave Dipole Pattern and Performance]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 546, Page 547, Section 14.4.4, Example 14.2, Figure 14.8a

A half-wave dipole has overall length $2\ell=\lambda/2$, so each arm has length $\ell=\lambda/4$ and $k\ell=\pi/2$. Substitution into the general dipole pattern eliminates the $\cos(k\ell)$ term and gives $F(\theta)=\cos[(\pi/2)\cos\theta]/\sin\theta$. The field is maximum broadside to the wire at $\theta=90^\circ$ and zero along its axis at $\theta=0$ and $180^\circ$. The half-power directions satisfy $F(\theta)=1/\sqrt{2}$ relative to the normalized maximum. Numerical solutions at $51^\circ$ and $129^\circ$ give a half-power beamwidth of $78^\circ$. Numerical integration of the pattern yields maximum directivity $D_{\max}=1.64$, equivalent to 2.15 dB, and radiation resistance $R_{\mathrm{rad}}=73\ \Omega$. The standing-wave current reaches its maximum at the feed, which places the antenna near resonance. These pattern and impedance values make the half-wave dipole a practical compromise between useful directivity, single-lobe behavior, and compatibility with conventional transmission-line impedances.

### Key planning details

- A half-wave dipole has $2\ell=\lambda/2$ and $k\ell=\pi/2$.
- Its pattern is $F(\theta)=\cos[(\pi/2)\cos\theta]/\sin\theta$.
- Pattern maxima occur broadside at $\theta=90^\circ$.
- Pattern zeros occur along the antenna axis at $\theta=0$ and $180^\circ$.
- The half-power angles are $51^\circ$ and $129^\circ$.
- The half-power beamwidth is $78^\circ$.
- The maximum directivity is 1.64, or 2.15 dB.
- The radiation resistance is approximately $73\ \Omega$.

### Source coverage

- Equation (66), Page 546 gives the half-wave pattern function.
- Example 14.2 identifies maxima at $\theta=\pi/2$ and zeros at $\theta=0$ and $\pi$.
- Example 14.2 solves the half-power equation numerically at $51^\circ$ and $129^\circ$.
- The calculated half-power beamwidth is $129^\circ-51^\circ=78^\circ$.
- The example reports $D_{\max}=1.64$, or 2.15 dB.
- The example reports $R_{\mathrm{rad}}=73\ \Omega$.
- Figure S26.P545.F14.8 includes the normalized half-wave pattern as the dashed curve.
