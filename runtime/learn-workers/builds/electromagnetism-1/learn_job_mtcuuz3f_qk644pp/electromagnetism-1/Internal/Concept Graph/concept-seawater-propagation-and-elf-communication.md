---
title: "Seawater Propagation and ELF Communication"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "seawater-propagation-and-elf-communication"
locations: ["Page 404", "Page 405"]
related: ["good-conductor-propagation-approximation", "skin-depth-and-field-confinement", "conductivity-as-imaginary-permittivity"]
---

## ConceptNode: Seawater Propagation and ELF Communication

Planning node for [[seawater-propagation-and-elf-communication|1.231 Seawater Propagation and ELF Communication]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 404, Page 405

Example 11.6 applies the good-conductor model to seawater, whose salt dissociates into mobile $\mathrm{Na}^+$ and $\mathrm{Cl}^-$ ions. At 1 MHz, the source uses $\sigma=4\ \mathrm{S/m}$ and $\epsilon'_r=81$. The calculated loss tangent is $\sigma/(\omega\epsilon')=8.9\times10^2$, confirming that seawater is a good conductor at this frequency and below. The resulting skin depth is $0.25\ \mathrm{m}$, wavelength is $\lambda=2\pi\delta=1.6\ \mathrm{m}$, and phase velocity is $v_p=\omega\delta=1.6\times10^6\ \mathrm{m/s}$. These values are dramatically smaller than the free-space wavelength of $300\ \mathrm{m}$ and velocity $c$. A 25 cm skin depth makes ordinary radio-frequency communication through seawater impractical. Because $\delta$ varies as $1/\sqrt{f}$, lowering the frequency to 10 Hz increases skin depth to about $80\ \mathrm{m}$ and gives a conductor wavelength near $500\ \mathrm{m}$. This supports submarine communication, but the enormous free-space wavelength requires very large transmitting antennas and the extremely low carrier frequency produces very slow data rates.

### Key planning details

- Salt ions make seawater conductive.
- At 1 MHz, seawater has $\sigma=4\ \mathrm{S/m}$ and $\epsilon'_r=81$.
- Its loss tangent is $8.9\times10^2$, so the good-conductor approximation applies.
- The 1 MHz skin depth is $0.25\ \mathrm{m}$.
- The conductor wavelength is $1.6\ \mathrm{m}$.
- The phase velocity is $1.6\times10^6\ \mathrm{m/s}$.
- At 10 Hz, the skin depth increases to approximately $80\ \mathrm{m}$.
- ELF communication gains penetration but suffers very low data rates and enormous antenna requirements.

### Source coverage

- Example 11.6 attributes seawater conductivity to mobile sodium and chloride ions.
- The loss-tangent calculation gives $8.9\times10^2\gg1$ at 1 MHz.
- The skin-depth calculation gives $\delta=0.25\ \mathrm{m}$.
- The source obtains $\lambda=1.6\ \mathrm{m}$ and $v_p=1.6\times10^6\ \mathrm{m/s}$.
- At 10 Hz, the source estimates $\delta\doteq80\ \mathrm{m}$ and $\lambda\doteq500\ \mathrm{m}$.
- The source notes that an ELF word can take several minutes to transmit.
