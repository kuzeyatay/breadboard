---
title: "1.171 Complex Instantaneous Voltage and Phasor Voltage"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 326"]
related: ["complex-representation-of-sinusoidal-waves", "standing-wave-from-oppositely-directed-waves", "phasor-domain-telegraphist-equations"]
---

# 1.171 Complex Instantaneous Voltage and Phasor Voltage

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 326

A sinusoidal transmission-line voltage can be represented at three related levels. The complex instantaneous voltage is $V_c(z,t)=V_0e^{\pm j\beta z}e^{j\omega t}$, which retains both spatial and temporal phase. The voltage phasor is obtained by suppressing the common time factor: $V_s(z)=V_0e^{\pm j\beta z}$. The real instantaneous voltage is reconstructed as $\mathcal{V}(z,t)=\operatorname{Re}\{V_s(z)e^{j\omega t}\}$. Phasor analysis is valid under sinusoidal steady-state conditions, meaning that the complex amplitude $V_0$ is time-independent and the waves being combined share one frequency. A time-varying amplitude would introduce additional frequency components and invalidate the single-frequency representation. Conceptually, the phasor freezes the common time evolution and exposes spatial magnitude and phase, allowing relative phases at different line positions and combinations of multiple same-frequency waves to be evaluated algebraically.

## Page-Grounded Details

#### Page 326

present example) will usually be used for the voltage or current amplitudes, with the understanding that these will generally be complex (having magnitude and phase).

Two additional definitions follow from Eq. (34). First, we define the complex instantaneous voltage as:
$$
V_{c}(z,t)=V_{0}\,e^{\pm j\beta z}\,e^{j\omega t}\quad{(35)}
$$
The phasor voltage is then formed by dropping the $e^{j\omega t}$ factor from the complex instantaneous form:
$$
V_{s}(z)=V_{0}\,e^{\pm j\beta z}\quad{(36)}
$$
The phasor voltage can be defined provided we have sinusoidal steady-state conditions-meaning that $V_{0}$ is independent of time. This has in fact been our assumption all along, because a time-varying amplitude would imply the existence of other frequency components in our signal. Again, we are treating only a single-frequency wave. The significance of the phasor voltage is that we are effectively letting time stand still and observing the stationary wave in space at $t=0$. The processes of evaluating relative phases between various line positions and of combining multiple waves is made much simpler in phasor form. Again, this works only if all waves under consideration have the sa

[Truncated for analysis]

## Core Ideas

- The complex instantaneous voltage is $V_c(z,t)=V_0e^{\pm j\beta z}e^{j\omega t}$.
- The phasor voltage is $V_s(z)=V_0e^{\pm j\beta z}$.
- The real voltage is $\mathcal{V}(z,t)=\operatorname{Re}\{V_s(z)e^{j\omega t}\}$.
- The phasor is formed by dropping the common factor $e^{j\omega t}$.
- Phasor combination requires all participating waves to have the same frequency.
- A time-independent complex amplitude is required for sinusoidal steady state.

## Source Anchors

- Equation (35) defines $V_c(z,t)$.
- Equation (36) defines $V_s(z)$.
- Equations (37a) and (37b) reconstruct the real voltage from the complex instantaneous form or phasor form.
- The text explains that time-varying amplitude implies other frequency components.

## Related Pages

- [[complex-representation-of-sinusoidal-waves|Complex Representation of Sinusoidal Waves]]
- [[standing-wave-from-oppositely-directed-waves|Standing Wave from Oppositely Directed Waves]]
- [[phasor-domain-telegraphist-equations|Phasor-Domain Telegraphist Equations]]

## Concept Dependencies

- derives-from: [[complex-representation-of-sinusoidal-waves|Complex Representation of Sinusoidal Waves]]
