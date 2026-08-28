---
title: "Dipole Relaxation Susceptibility"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "dipole-relaxation-susceptibility"
locations: ["Page 588, time-harmonic orientational response", "Page 589, Equation (E.23)"]
related: ["permanent-dipole-orientation", "microwave-absorption-by-polar-water", "additive-susceptibility-of-multi-mechanism-materials", "resonant-susceptibility-and-complex-permittivity"]
---

## ConceptNode: Dipole Relaxation Susceptibility

Planning node for [[dipole-relaxation-susceptibility|1.362 Dipole Relaxation Susceptibility]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 588, time-harmonic orientational response, Page 589, Equation (E.23)

In a time-harmonic field, permanent molecular dipoles repeatedly attempt to reverse their orientation as the field reverses. Thermal motion opposes this ordered alignment and acts like a restoring or viscous influence. At low frequencies, each half-cycle lasts long enough for a relatively large orientational polarization to develop. As frequency rises, the field reverses before the dipoles can align fully, so the polarization amplitude decreases. Unlike the Lorentz electron oscillator, this process has no resonant frequency and behaves like an overdamped response. Its complex susceptibility is $$\chi_{\mathrm{rel}}=\frac{Np^2/\epsilon_0}{3k_BT(1+j\omega\tau)},$$ where $N$ is molecular number density, $p$ is each molecule's permanent dipole magnitude, $k_B$ is Boltzmann's constant, $T$ is absolute temperature in kelvins, $\omega$ is driving angular frequency, and $\tau$ is the thermal randomization time. The parameter $\tau$ is the time for polarization to decay to $1/e$ of its initial value after the field is removed. The response has the same mathematical form as a sinusoidally driven series RC circuit with time constant $RC$.

### Key planning details

- Thermal motion opposes ordered molecular alignment.
- Low-frequency fields permit more complete alignment during each cycle.
- Polarization amplitude decreases as frequency increases.
- Dipole relaxation has no resonant frequency.
- The susceptibility contains the relaxation factor $1/(1+j\omega\tau)$.
- $\tau$ is the $1/e$ polarization-decay time after field removal.
- The response is analogous to a series RC circuit with time constant $RC$.

### Source coverage

- Page 588 describes thermal motion as both a restoring influence and an effective viscous force.
- The source states that alignment is more complete at lower frequencies and weakens as frequency rises.
- The source explicitly states that no resonant frequency is associated with dipole relaxation.
- Equation (E.23): $$\chi_{\mathrm{rel}}=\frac{Np^2/\epsilon_0}{3k_BT(1+j\omega\tau)}.$$
- $\tau$ is defined as the time for $P$ to relax to $1/e$ of its original value after the field is turned off.
- The response is compared with a sinusoidally driven series RC circuit.
