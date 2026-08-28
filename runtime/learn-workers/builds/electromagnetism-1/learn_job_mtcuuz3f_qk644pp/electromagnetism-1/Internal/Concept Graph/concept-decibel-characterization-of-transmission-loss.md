---
title: "Decibel Characterization of Transmission Loss"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "decibel-characterization-of-transmission-loss"
locations: ["Page 333", "Page 334"]
related: ["average-power-in-a-lossy-transmission-line", "low-loss-expansion-of-the-propagation-constant", "power-reflection-and-load-absorption", "cascaded-line-and-junction-loss"]
---

## ConceptNode: Decibel Characterization of Transmission Loss

Planning node for [[decibel-characterization-of-transmission-loss|1.182 Decibel Characterization of Transmission Loss]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 333, Page 334

Since average power varies as $\langle\mathcal{P}(z)\rangle=\langle\mathcal{P}(0)\rangle e^{-2\alpha z}$, attenuation can be expressed as a logarithmic power loss. The conversion between nepers and decibels gives $$L_{\mathrm{dB}}=10\log_{10}\left(\frac{\langle\mathcal{P}(0)\rangle}{\langle\mathcal{P}(z)\rangle}\right)=8.69\alpha z.$$ Because power is proportional to squared voltage amplitude, the equivalent voltage form is $L_{\mathrm{dB}}=20\log_{10}(|V_0(0)|/|V_0(z)|)$. Example 10.4 shows that a $2.0$ dB loss leaves a power fraction $10^{-0.2}=0.63$, while half the distance produces a $1.0$ dB loss and leaves $0.79$. The corresponding attenuation coefficient is $0.012$ Np/m for a $20$ m line. Decibels are especially useful because losses of cascaded lines, joints, and devices add directly rather than requiring repeated multiplication of power ratios.

### Key planning details

- $\langle\mathcal{P}(z)\rangle/\langle\mathcal{P}(0)\rangle=e^{-2\alpha z}$.
- $L_{\mathrm{dB}}=8.69\alpha z$ when $\alpha$ is in Np per unit distance.
- Power ratios use $10\log_{10}$.
- Voltage amplitude ratios use $20\log_{10}$.
- A positive loss uses input power divided by output power.
- Cascaded dB losses add directly.

### Source coverage

- Equations (65) through (69) derive exponential and decibel loss relations.
- Example 10.4 finds an output fraction of $0.63$ after a $2.0$ dB loss.
- Example 10.4 finds a midpoint fraction of $0.79$ and $\alpha=0.012\ \text{Np/m}$.
- D10.2 combines two line losses and a $3$ dB joint loss, giving $5.3\%$ output power.
