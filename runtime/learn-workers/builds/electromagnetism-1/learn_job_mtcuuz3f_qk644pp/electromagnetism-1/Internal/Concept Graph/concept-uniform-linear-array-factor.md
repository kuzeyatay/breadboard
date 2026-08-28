---
title: "Uniform Linear Array Factor"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "uniform-linear-array-factor"
locations: ["Page 553", "Page 554", "Section 14.6", "Section 14.6.1", "Figure 14.13"]
related: ["pattern-multiplication-for-antenna-arrays", "uniform-linear-array-beam-conditions", "broadside-and-endfire-two-element-arrays", "two-element-array-far-zone-phase-geometry"]
---

## ConceptNode: Uniform Linear Array Factor

Planning node for [[uniform-linear-array-factor|1.328 Uniform Linear Array Factor]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 553, Page 554, Section 14.6, Section 14.6.1, Figure 14.13

A uniform linear array contains $n$ identical elements placed along a straight line with equal spacing $d$, equal current amplitudes $I_0$, and constant phase progression $\xi$ between adjacent elements. For the geometry used in the source, the elements lie along $x$ and each dipole is oriented along $z$. The phase increment observed at a far-zone point remains $\psi=\xi+kd\sin\theta\cos\phi$. Normalizing by the number of elements gives the array factor as the magnitude of a geometric series: $|A_n|=(1/n)|1+e^{j\psi}+\cdots+e^{j(n-1)\psi}|$. Summing the series and applying Euler identities produces the closed form $|A_n(\psi)|=(1/n)|\sin(n\psi/2)/\sin(\psi/2)|$. The complete far-zone field again follows pattern multiplication: $|E_{\theta P}|=(n|E_0|/r)|F(\theta)||A_n(\theta,\phi)|$. The normalization makes the principal maximum of the array factor equal to one, while the explicit factor $n$ accounts for coherent addition of the element fields.

### Key planning details

- A uniform linear array has identical elements, equal spacing, equal current amplitudes, and constant phase progression.
- For an $x$-directed array, $\psi=\xi+kd\sin\theta\cos\phi$.
- The normalized factor is a geometric sum of $n$ phasors.
- The series form is $|A_n|=(1/n)|\sum_{q=0}^{n-1}e^{jq\psi}|$.
- The closed form is $|A_n|=(1/n)|\sin(n\psi/2)/\sin(\psi/2)|$.
- The total field magnitude is $(n|E_0|/r)|F||A_n|$.
- The result extends pattern multiplication from two elements to $n$ elements.

### Source coverage

- Figure S26.P554.F14.13 shows $n$ dipoles arranged along $x$, oriented along $z$, with spacing $d$ and phase shift $\xi$.
- Equation (78), Page 553 expresses the two-element normalized factor as $(1/2)|1+e^{j\psi}|$.
- Equation (79), Page 554 extends the phasor sum to $n$ elements.
- Equation (80), Page 554 evaluates the geometric progression in closed form.
- Equation (81), Page 554 gives $|A_n|=(1/n)|\sin(n\psi/2)/\sin(\psi/2)|$.
- Equation (82), Page 554 gives the array far-field magnitude using pattern multiplication.
