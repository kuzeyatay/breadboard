---
title: "Distributed Line Parameters, Attenuation, and Power Budgets"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "distributed-line-parameters-attenuation-and-power-budgets"
locations: ["Page 372", "Page 373", "Page 374", "Page 375"]
related: ["transmission-line-reflection-and-standing-wave-analysis", "quarter-wave-impedance-transformation", "lossy-dielectric-propagation-and-complex-wavenumber"]
---

## ConceptNode: Distributed Line Parameters, Attenuation, and Power Budgets

Planning node for [[distributed-line-parameters-attenuation-and-power-budgets|1.207 Distributed Line Parameters, Attenuation, and Power Budgets]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 372, Page 373, Page 374, Page 375

The end-of-chapter problems consolidate how the distributed parameters $R$, $L$, $G$, and $C$ determine propagation, characteristic impedance, attenuation, phase, and wavelength. They also connect field and circuit quantities to practical power budgets. Tasks include calculating $\alpha$, $\beta$, $\lambda$, and $Z_0$ from per-unit-length parameters; converting attenuation between propagation coefficients and decibels per meter; accumulating losses across cascaded line sections and splices; and determining the power delivered to a mismatched receiver. The dBm scale is defined relative to one milliwatt, making additive loss accounting possible in logarithmic form. Several problems require separating line attenuation from mismatch loss so that transmitted, reflected, and absorbed powers are not confused. Skin effect supplies a frequency-dependent extension: line resistance follows $R=A_0f^{1/2}$, so attenuation and delivered power must be recomputed when frequency changes. The Gaussian-pulse problem also asks for load-dissipated energy, requiring the reflected and transmitted pulse amplitudes or powers to be integrated over time.

### Key planning details

- Distributed parameters $R$, $L$, $G$, and $C$ determine $\alpha$, $\beta$, $\lambda$, and $Z_0$.
- Power loss ratings in dB/m add linearly with distance when forming a link budget.
- Splice loss adds to distributed losses in a cascaded transmission path.
- The dBm definition is $P(\mathrm{dBm})=10\log_{10}[P(\mathrm{mW})/1\,\mathrm{mW}]$.
- Receiver sensitivity specifies the minimum received power, not the required line-input power.
- Load mismatch causes reflection and must be included separately from propagation loss.
- Skin-effect resistance follows $R=A_0f^{1/2}$ in the stated model.
- Pulse energy is obtained by integrating instantaneous load power over time.

### Source coverage

- Problem 10.1 gives $\omega=6\times10^8\,\mathrm{rad/s}$, $L=0.350\,\mu\mathrm{H/m}$, $C=40\,\mathrm{pF/m}$, $G=0$, and $R=15.0\,\Omega/\mathrm{m}$.
- Problem 10.3 specifies $V(t)=V_0e^{-t^2/(2T^2)}$, with $V_0=10\,\mathrm{V}$, $T=20\,\mathrm{ns}$, $Z_0=50\,\Omega$, and a $100\,\Omega$ load.
- Problem 10.7 combines 40 m at 0.1 dB/m, 25 m at 0.2 dB/m, and a 2 dB splice loss.
- Problem 10.8 explicitly defines dBm and gives a receiver sensitivity of $-20$ dBm.
- Problem 10.9 uses a complex characteristic impedance $Z_0=75+j10\,\Omega$ and a power loss coefficient of 0.05 dB/m.
- Problem 10.13 states the skin-effect model $R=A_0f^{1/2}$ and supplies a measured 10.0 dB loss over 100 m at 100 MHz.
