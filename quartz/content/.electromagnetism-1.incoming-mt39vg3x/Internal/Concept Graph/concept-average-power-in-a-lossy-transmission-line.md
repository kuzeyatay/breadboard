---
title: "Average Power in a Lossy Transmission Line"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "average-power-in-a-lossy-transmission-line"
locations: ["Page 331", "Page 332", "Page 333"]
related: ["attenuation-and-phase-in-a-lossy-line", "characteristic-impedance-of-a-transmission-line", "decibel-characterization-of-transmission-loss", "power-reflection-and-load-absorption"]
---

## ConceptNode: Average Power in a Lossy Transmission Line

Planning node for [[average-power-in-a-lossy-transmission-line|1.181 Average Power in a Lossy Transmission Line]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 331, Page 332, Page 333

Instantaneous power is the product of the real voltage and current. For a forward wave, both amplitudes decay as $e^{-\alpha z}$, so their product contains $e^{-2\alpha z}$. If voltage and current differ in phase by $\theta$, averaging their cosine product over one period removes the double-frequency term and retains the constant term proportional to $\cos\theta$. The result is $$\langle\mathcal{P}\rangle=\frac12|V_0||I_0|e^{-2\alpha z}\cos\theta=\frac12\frac{|V_0|^2}{|Z_0|}e^{-2\alpha z}\cos\theta.$$ The same result follows directly from phasors using $\langle\mathcal{P}\rangle=\tfrac12\operatorname{Re}\{V_sI_s^*\}$. Conjugating the current phasor cancels the common spatial phase while preserving the voltage-current phase difference. This formula applies to any single-frequency wave and shows that power decays at twice the exponential rate of voltage or current amplitude.

### Key planning details

- Both voltage and current amplitudes decay as $e^{-\alpha z}$.
- Power therefore decays as $e^{-2\alpha z}$.
- Time averaging removes the term oscillating at $2\omega$.
- The voltage-current phase factor is $\cos\theta$.
- $\langle\mathcal{P}\rangle=\tfrac12\operatorname{Re}\{V_sI_s^*\}$.
- Only the current phasor is conjugated in the power expression.

### Source coverage

- Equations (57) through (60) derive average power by direct time integration.
- Equations (61) and (62) give the forward voltage and current phasors.
- Equation (63) states $\langle\mathcal{P}\rangle=\tfrac12\operatorname{Re}\{V_sI_s^*\}$.
- Equation (64) reproduces the time-integrated result.
