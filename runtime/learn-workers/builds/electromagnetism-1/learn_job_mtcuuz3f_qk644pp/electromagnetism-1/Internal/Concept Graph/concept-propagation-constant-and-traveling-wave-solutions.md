---
title: "Propagation Constant and Traveling-Wave Solutions"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "propagation-constant-and-traveling-wave-solutions"
locations: ["Page 327", "Page 328", "Page 329"]
related: ["phasor-domain-telegraphist-equations", "characteristic-impedance-of-a-transmission-line", "attenuation-and-phase-in-a-lossy-line", "average-power-in-a-lossy-transmission-line"]
---

## ConceptNode: Propagation Constant and Traveling-Wave Solutions

Planning node for [[propagation-constant-and-traveling-wave-solutions|1.174 Propagation Constant and Traveling-Wave Solutions]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 327, Page 328, Page 329

The phasor wave equation is governed by the complex propagation constant $\gamma$, defined by $\gamma=\sqrt{(R+j\omega L)(G+j\omega C)}=\sqrt{ZY}=\alpha+j\beta$. The general voltage solution is $V_s(z)=V_0^+e^{-\gamma z}+V_0^-e^{\gamma z}$, and the current has the corresponding form $I_s(z)=I_0^+e^{-\gamma z}+I_0^-e^{\gamma z}$. The superscripts identify net waves traveling in the positive and negative $z$ directions. Separating $\gamma$ into real and imaginary parts reveals two physical effects: $\alpha$ controls exponential amplitude change and $\beta$ controls spatial phase accumulation. The forward wave contains $e^{-\alpha z}e^{-j\beta z}$, while the backward wave contains $e^{\alpha z}e^{j\beta z}$ under the selected coordinate convention. These solutions provide the common mathematical structure used throughout the later analysis of low-loss behavior, reflected waves, power attenuation, and finite line impedance.

### Key planning details

- $\gamma=\sqrt{ZY}=\alpha+j\beta$.
- $\alpha$ is the attenuation coefficient and $\beta$ is the phase constant.
- The voltage solution is $V_0^+e^{-\gamma z}+V_0^-e^{\gamma z}$.
- The current solution has the same exponential structure.
- The two terms represent forward and backward propagation.
- Separating $\gamma$ exposes amplitude attenuation and spatial phase.

### Source coverage

- Equation (41) defines $\gamma$.
- Equations (42a) and (42b) give the general voltage and current phasor solutions.
- Equation (48) expands the voltage solution using $\gamma=\alpha+j\beta$.
- Equation (49) converts the lossy forward and backward waves to real instantaneous form.
