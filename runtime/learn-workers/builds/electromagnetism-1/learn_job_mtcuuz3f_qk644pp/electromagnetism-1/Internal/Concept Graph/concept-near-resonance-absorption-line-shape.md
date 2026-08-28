---
title: "Near-Resonance Absorption Line Shape"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "near-resonance-absorption-line-shape"
locations: ["Page 586, Equations (E.20) and (E.21)", "Page 587, Figure E.2 and its interpretation"]
related: ["damping-and-dephasing-of-bound-electrons", "resonant-susceptibility-and-complex-permittivity", "material-dispersion-and-pulse-broadening"]
---

## ConceptNode: Near-Resonance Absorption Line Shape

Planning node for [[near-resonance-absorption-line-shape|1.358 Near-Resonance Absorption Line Shape]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 586, Equations (E.20) and (E.21), Page 587, Figure E.2 and its interpretation

Near the natural frequency, the Lorentz susceptibility can be written in terms of a normalized detuning parameter. The source defines $$\delta_n=\frac{2}{\gamma_d}(\omega-\omega_0),$$ which measures the frequency offset from resonance relative to the damping-controlled linewidth. The approximate susceptibility is $$\chi_{\mathrm{res}}\doteq-\frac{Ne^2}{\epsilon_0m\omega_0\gamma_d}\left(\frac{j+\delta_n}{1+\delta_n^2}\right).$$ Figure E.2 separates this expression into its real and imaginary components. The imaginary component is symmetric around $\omega_0$, reaches its maximum at resonance, and has a full width at half maximum equal to $\gamma_d$. Because the imaginary permittivity governs dielectric loss, wave attenuation is greatest near the resonant frequency. Farther from resonance, the imaginary component becomes small, attenuation weakens, and the material becomes comparatively transparent. The real component changes sign across resonance and varies substantially even where absorption is weak, so a material can exhibit strong dispersion without strong attenuation.

### Key planning details

- Normalized detuning is $\delta_n=2(\omega-\omega_0)/\gamma_d$.
- The near-resonance susceptibility has a Lorentzian denominator $1+\delta_n^2$.
- The imaginary susceptibility is symmetric about resonance.
- Its full width at half maximum is $\gamma_d$.
- Attenuation is greatest where the imaginary susceptibility is largest.
- The material becomes relatively transparent away from resonance.
- The real susceptibility can remain strongly frequency-dependent outside the absorption peak.

### Source coverage

- Equation (E.20): $$\chi_{\mathrm{res}}\doteq-\frac{Ne^2}{\epsilon_0m\omega_0\gamma_d}\left(\frac{j+\delta_n}{1+\delta_n^2}\right).$$
- Equation (E.21): $$\delta_n=\frac{2}{\gamma_d}(\omega-\omega_0).$$
- Source figure S1.P587.F1, Figure E.2, plots the real and imaginary components of resonant susceptibility against frequency.
- The text identifies the imaginary-part full width at half maximum as $\gamma_d$.
- The source states that attenuation maximizes near the resonant frequency and is relatively weak away from resonance.
