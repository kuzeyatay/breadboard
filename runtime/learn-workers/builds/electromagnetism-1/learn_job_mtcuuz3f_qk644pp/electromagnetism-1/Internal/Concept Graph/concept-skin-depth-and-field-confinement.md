---
title: "Skin Depth and Field Confinement"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "skin-depth-and-field-confinement"
locations: ["Page 403", "Page 404"]
related: ["good-conductor-propagation-approximation", "seawater-propagation-and-elf-communication", "good-conductor-intrinsic-impedance-and-power-density", "skin-effect-resistance"]
---

## ConceptNode: Skin Depth and Field Confinement

Planning node for [[skin-depth-and-field-confinement|1.230 Skin Depth and Field Confinement]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 403, Page 404

The skin depth $\delta$ is the distance into a good conductor at which electric-field and current-density amplitudes fall to $e^{-1}=0.368$ of their surface values. Since $\alpha=\beta=\sqrt{\pi f\mu\sigma}$, it is given by $\delta=1/\sqrt{\pi f\mu\sigma}=1/\alpha=1/\beta$. Power density contains the squared field attenuation and therefore falls to $e^{-2}=0.135$ of its surface value after one skin depth. For copper, the source gives $\delta_{\mathrm{Cu}}=0.066/\sqrt{f}$ with frequency in hertz, producing $8.53\ \mathrm{mm}$ at 60 Hz and $6.61\times10^{-4}\ \mathrm{mm}$ at 10,000 MHz. At high frequencies, fields are essentially zero more than a few skin depths below the surface. Electromagnetic energy therefore travels primarily in the space surrounding a good conductor, while the conductor guides the wave. The practical consequences include hollow high-current conductors at power frequencies and thin conductive coatings at microwave frequencies. Within a good conductor, wavelength and phase velocity are related directly to skin depth by $\lambda=2\pi\delta$ and $v_p=\omega\delta$.

### Key planning details

- Skin depth is $\delta=1/\sqrt{\pi f\mu\sigma}$.
- It equals both $1/\alpha$ and $1/\beta$ for a good conductor.
- Field amplitude falls to $e^{-1}$ after one skin depth.
- Power density falls to $e^{-2}=0.135$ after one skin depth.
- Skin depth decreases with the square root of frequency, permeability, and conductivity.
- Fields are negligible beyond a few skin depths in a good conductor.
- The conductor wavelength is $\lambda=2\pi\delta$.
- The conductor phase velocity is $v_p=\omega\delta$.

### Source coverage

- Equation (82) defines $\delta=1/\sqrt{\pi f\mu\sigma}=1/\alpha=1/\beta$.
- The copper relation is given as $\delta_{\mathrm{Cu}}=0.066/\sqrt{f}$.
- Copper skin depth is $8.53\ \mathrm{mm}$ at 60 Hz and $6.61\times10^{-4}\ \mathrm{mm}$ at 10,000 MHz.
- The source states that fields are essentially zero at distances greater than a few skin depths.
- Equation (83) gives $\lambda=2\pi\delta$.
- Equation (84) gives $v_p=\omega\delta$.
- For copper at 60 Hz, the source gives $\lambda=5.36\ \mathrm{cm}$ and $v_p=3.22\ \mathrm{m/s}$.
