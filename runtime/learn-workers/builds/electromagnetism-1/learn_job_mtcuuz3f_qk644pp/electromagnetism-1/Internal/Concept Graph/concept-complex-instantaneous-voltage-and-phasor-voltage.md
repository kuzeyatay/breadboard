---
title: "Complex Instantaneous Voltage and Phasor Voltage"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "complex-instantaneous-voltage-and-phasor-voltage"
locations: ["Page 326"]
related: ["complex-representation-of-sinusoidal-waves", "standing-wave-from-oppositely-directed-waves", "phasor-domain-telegraphist-equations"]
---

## ConceptNode: Complex Instantaneous Voltage and Phasor Voltage

Planning node for [[complex-instantaneous-voltage-and-phasor-voltage|1.171 Complex Instantaneous Voltage and Phasor Voltage]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 326

A sinusoidal transmission-line voltage can be represented at three related levels. The complex instantaneous voltage is $V_c(z,t)=V_0e^{\pm j\beta z}e^{j\omega t}$, which retains both spatial and temporal phase. The voltage phasor is obtained by suppressing the common time factor: $V_s(z)=V_0e^{\pm j\beta z}$. The real instantaneous voltage is reconstructed as $\mathcal{V}(z,t)=\operatorname{Re}\{V_s(z)e^{j\omega t}\}$. Phasor analysis is valid under sinusoidal steady-state conditions, meaning that the complex amplitude $V_0$ is time-independent and the waves being combined share one frequency. A time-varying amplitude would introduce additional frequency components and invalidate the single-frequency representation. Conceptually, the phasor freezes the common time evolution and exposes spatial magnitude and phase, allowing relative phases at different line positions and combinations of multiple same-frequency waves to be evaluated algebraically.

### Key planning details

- The complex instantaneous voltage is $V_c(z,t)=V_0e^{\pm j\beta z}e^{j\omega t}$.
- The phasor voltage is $V_s(z)=V_0e^{\pm j\beta z}$.
- The real voltage is $\mathcal{V}(z,t)=\operatorname{Re}\{V_s(z)e^{j\omega t}\}$.
- The phasor is formed by dropping the common factor $e^{j\omega t}$.
- Phasor combination requires all participating waves to have the same frequency.
- A time-independent complex amplitude is required for sinusoidal steady state.

### Source coverage

- Equation (35) defines $V_c(z,t)$.
- Equation (36) defines $V_s(z)$.
- Equations (37a) and (37b) reconstruct the real voltage from the complex instantaneous form or phasor form.
- The text explains that time-varying amplitude implies other frequency components.
