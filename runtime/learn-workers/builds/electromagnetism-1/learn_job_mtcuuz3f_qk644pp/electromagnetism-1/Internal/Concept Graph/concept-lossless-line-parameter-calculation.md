---
title: "Lossless-Line Parameter Calculation"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "lossless-line-parameter-calculation"
locations: ["Page 328", "Page 329"]
related: ["characteristic-impedance-of-a-transmission-line", "propagation-constant-and-traveling-wave-solutions", "attenuation-and-phase-in-a-lossy-line", "finite-lossless-line-input-impedance"]
---

## ConceptNode: Lossless-Line Parameter Calculation

Planning node for [[lossless-line-parameter-calculation|1.176 Lossless-Line Parameter Calculation]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 328, Page 329

For a lossless transmission line, setting $R=0$ and $G=0$ simplifies the principal line quantities. Characteristic impedance becomes $Z_0=\sqrt{L/C}$, the propagation constant becomes $\gamma=j\omega\sqrt{LC}$, the phase constant is $\beta=\omega\sqrt{LC}$, and phase velocity is $v_p=\omega/\beta=1/\sqrt{LC}$. Example 10.2 demonstrates the calculation for an $80$ cm line operating at $600$ MHz with $L=0.25\ \mu\text{H/m}$ and $C=100\ \text{pF/m}$. It obtains $Z_0=50\ \Omega$, $\beta=18.85\ \text{rad/m}$, and $v_p=2\times10^8\ \text{m/s}$. The physical line length is not needed for these intrinsic per-unit-length propagation quantities, although it would be needed to calculate the total electrical phase length $\beta l$. This example provides a reusable calculation sequence from distributed inductance, capacitance, and operating frequency.

### Key planning details

- Lossless operation means $R=G=0$.
- $Z_0=\sqrt{L/C}$.
- $\beta=\omega\sqrt{LC}$.
- $v_p=1/\sqrt{LC}=\omega/\beta$.
- Use $\omega=2\pi f$ before evaluating $\beta$.
- Electrical length is obtained separately as $\beta l$.

### Source coverage

- Example 10.2 specifies $f=600$ MHz, $L=0.25\ \mu\text{H/m}$, and $C=100\ \text{pF/m}$.
- The example obtains $Z_0=50\ \Omega$.
- The calculated phase constant is $18.85\ \text{rad/m}$.
- The calculated phase velocity is $2\times10^8\ \text{m/s}$.
