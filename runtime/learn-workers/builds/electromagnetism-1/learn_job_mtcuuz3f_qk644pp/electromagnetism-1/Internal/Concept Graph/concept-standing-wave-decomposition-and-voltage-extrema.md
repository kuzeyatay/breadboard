---
title: "Standing-Wave Decomposition and Voltage Extrema"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "standing-wave-decomposition-and-voltage-extrema"
locations: ["Page 337", "Page 338", "Page 339", "Page 340"]
related: ["standing-wave-from-oppositely-directed-waves", "reflection-at-a-load-discontinuity", "voltage-standing-wave-ratio-and-load-recovery", "finite-lossless-line-input-impedance"]
---

## ConceptNode: Standing-Wave Decomposition and Voltage Extrema

Planning node for [[standing-wave-decomposition-and-voltage-extrema|1.186 Standing-Wave Decomposition and Voltage Extrema]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 337, Page 338, Page 339, Page 340

On a lossless line terminated at $z=0$, the total voltage is the sum of incident and reflected phasors: $V_{sT}(z)=V_0e^{-j\beta z}+\Gamma V_0e^{j\beta z}$, where $\Gamma=|\Gamma|e^{j\phi}$. Algebraic rearrangement separates the real voltage into a traveling component of amplitude $(1-|\Gamma|)V_0$ and a standing component of amplitude $2|\Gamma|V_0$. The extrema are more directly found by comparing the phases of the two phasor terms. Destructive alignment gives $$z_{\min}=-\frac{\phi+(2m+1)\pi}{2\beta},\qquad V_{\min}=V_0(1-|\Gamma|),$$ while constructive alignment gives $$z_{\max}=-\frac{\phi+2m\pi}{2\beta},\qquad V_{\max}=V_0(1+|\Gamma|).$$ Adjacent minima and adjacent maxima are separated by $\lambda/2$. Figures 10.6 and the slotted-line discussion connect the reflection-coefficient phase to the displacement of the extrema relative to the load.

### Key planning details

- The total line voltage is the sum of incident and reflected phasors.
- The traveling-wave amplitude is $(1-|\Gamma|)V_0$.
- The standing-wave amplitude is $2|\Gamma|V_0$.
- $V_{\min}=V_0(1-|\Gamma|)$.
- $V_{\max}=V_0(1+|\Gamma|)$.
- Successive minima or maxima are separated by $\lambda/2$.
- The phase $\phi$ determines extremum locations relative to the load.

### Source coverage

- Equations (79) through (83) transform the incident-reflected sum.
- Equation (84) explicitly labels traveling-wave and standing-wave components.
- Equations (86) and (89) give minimum and maximum locations.
- Equations (87) and (90) give minimum and maximum amplitudes.
- Figure 10.6 plots $|V_{sT}|$ and identifies extrema determined by $\phi$.
- The short-circuit case has a voltage null at the load and varies as $|\sin(\beta z)|$.
