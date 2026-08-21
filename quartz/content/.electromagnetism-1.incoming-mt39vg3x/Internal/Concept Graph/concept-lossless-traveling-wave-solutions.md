---
title: "Lossless Traveling-Wave Solutions"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "lossless-traveling-wave-solutions"
locations: ["Page 321", "Page 322", "Section 10.3: Lossless Propagation"]
related: ["general-transmission-line-wave-equations", "lc-ladder-and-pulse-forming-network", "characteristic-impedance-and-wave-current-direction", "sinusoidal-phase-propagation-and-wavelength"]
---

## ConceptNode: Lossless Traveling-Wave Solutions

Planning node for [[lossless-traveling-wave-solutions|1.166 Lossless Traveling-Wave Solutions]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 321, Page 322, Section 10.3: Lossless Propagation

For a lossless line, $R=G=0$, so the voltage wave equation reduces to $$\frac{\partial^2V}{\partial z^2}=LC\frac{\partial^2V}{\partial t^2}.$$ Its general solution is $$V(z,t)=f_1\left(t-\frac{z}{v}\right)+f_2\left(t+\frac{z}{v}\right)=V^++V^-.$$ The function $f_1$ propagates in the positive $z$ direction because a fixed argument requires $z$ to increase as $t$ increases. The function $f_2$ propagates in the negative $z$ direction because fixed argument requires $z$ to decrease. Applying the chain rule gives $\partial^2f_1/\partial z^2=f_1''/v^2$ and $\partial^2f_1/\partial t^2=f_1''$. Substitution into the wave equation requires $$v=\frac{1}{\sqrt{LC}}.$$ The same propagation speed applies to the current wave.

### Key planning details

- Lossless propagation requires $R=G=0$.
- The general solution is a sum of forward and backward arbitrary waveforms.
- $t-z/v$ denotes positive-$z$ propagation.
- $t+z/v$ denotes negative-$z$ propagation.
- The lossless wave velocity is $v=1/\sqrt{LC}$.

### Source coverage

- Equation (13) on Page 321 is the lossless voltage wave equation.
- Equation (14) gives the forward and backward arbitrary-function solution.
- Equations (15) through (18) on Pages 321 and 322 verify the solution using the chain rule.
- Equation (19) identifies $v=1/\sqrt{LC}$.
