---
title: "Wave Superposition and Current Standing Waves"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "wave-superposition-and-current-standing-waves"
locations: ["Page 372", "Page 373", "Page 374"]
related: ["charged-line-transients-and-reflection-diagrams", "transmission-line-reflection-and-standing-wave-analysis", "traveling-wave-direction-and-sinusoidal-solutions"]
---

## ConceptNode: Wave Superposition and Current Standing Waves

Planning node for [[wave-superposition-and-current-standing-waves|1.208 Wave Superposition and Current Standing Waves]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 372, Page 373, Page 374

Traveling waves on transmission lines combine by linear superposition. The problem set asks for single-wave representations formed from equal-frequency waves with a phase offset, as well as combinations of waves at frequencies $\omega$ and $3\omega$. For an open-circuited lossless line, the voltage reflection coefficient is unity, so the reflected voltage has the same phase at the load. The corresponding reflected current reverses sign, ensuring that incident and reflected currents cancel at the open end. Combining these current waves produces a standing-wave pattern whose temporal and spatial factors can be separated through trigonometric identities. In lossy lines, superposed waves also carry the attenuation factor $e^{-\alpha z}$, and the current includes the phase of the complex characteristic impedance $Z_0=|Z_0|e^{j\delta}$. The associated average power must therefore be formed consistently from voltage and current phase relationships. These exercises teach a reusable method: write each wave in complex instantaneous form, combine algebraically, then take the real part and simplify to expose amplitude modulation, spatial standing-wave structure, or average power.

### Key planning details

- Linear wave solutions can be added before converting back to real instantaneous form.
- Equal-frequency waves with phase separation can be reduced to one sinusoid with a new amplitude and phase.
- An open circuit gives zero total load current through cancellation of incident and reflected current waves.
- Standing waves arise from equal-frequency waves traveling in opposite directions.
- A complex $Z_0$ introduces a voltage-current phase difference in lossy lines.
- Different-frequency waves can be combined in complex form to reveal a modulated spatial pattern.
- Average power depends on the relative phase between voltage and current.

### Source coverage

- Problem 10.4 specifies total voltage reflection with zero phase shift at an open load and asks for the real instantaneous current standing wave.
- Problem 10.5 specifies two equal-amplitude waves separated by $\phi$ in a lossy line with $Z_0=|Z_0|e^{j\delta}$.
- Problem 10.11 combines forward waves at $\omega$ and $3\omega$, with phase constants $\beta$ and $3\beta$, and requests a plot versus $\beta z$ at $t=0$.
- Page 372 states that current at the open end must always sum to zero.
- The current-wave values on Page 372 explicitly use opposite signs for reflected waves.
