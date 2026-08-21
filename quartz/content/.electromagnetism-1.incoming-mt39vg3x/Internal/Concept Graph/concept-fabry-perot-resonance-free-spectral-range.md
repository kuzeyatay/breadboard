---
title: "Fabry-Perot Resonance and Free Spectral Range"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "fabry-perot-resonance-free-spectral-range"
locations: ["Page 436", "Page 437", "Section 12.3.3: Special Cases: Half-Wave and Quarter-Wave Layers"]
related: ["half-wave-matching", "refractive-index-material-wave-parameters", "quarter-wave-matching-antireflection-coatings", "frequency-dependent-refractive-index-angular-dispersion"]
---

## ConceptNode: Fabry-Perot Resonance and Free Spectral Range

Planning node for [[fabry-perot-resonance-free-spectral-range|1.256 Fabry-Perot Resonance and Free Spectral Range]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 436, Page 437, Section 12.3.3: Special Cases: Half-Wave and Quarter-Wave Layers

A simple Fabry-Perot interferometer can be modeled as a transparent slab whose thickness supports half-wave transmission resonances. For a slab of index $n$ and thickness $l$, transmitted wavelengths satisfy $\lambda=\lambda_0/n=2l/m$, where $m$ is the number of half-wavelengths inside the material. Several integer orders can therefore be transmitted. To isolate one desired wavelength, adjacent resonant wavelengths must be separated farther than the input spectrum's width. Subtracting neighboring resonance wavelengths gives the approximate free spectral range inside the material, $\Delta\lambda_f\approx\lambda^2/(2l)$. Expressed using free-space wavelength, it becomes $\Delta\lambda_{f0}\approx\lambda_0^2/(2nl)$. A narrow-band filter can isolate one order when the spectrum being filtered is narrower than this free spectral range. The worked example applies that criterion to a 600 nm spectrum with 50 nm full width and glass index 1.45, obtaining $l<2.5\ \mu\mathrm{m}$. Because such a thin glass plate is impractical, the source describes an adjustable air gap between thicker antireflection-coated plates as a more useful implementation.

### Key planning details

- Fabry-Perot transmission orders satisfy $\lambda=2l/m$ inside the material.
- The order number is $m=2l/\lambda=2nl/\lambda_0$.
- Adjacent resonances are separated by $\Delta\lambda_f\approx\lambda^2/(2l)$.
- The free-space free spectral range is $\Delta\lambda_{f0}\approx\lambda_0^2/(2nl)$.
- Single-order filtering requires the input spectral width to be smaller than the free spectral range.
- Reducing cavity thickness increases the free spectral range.
- An adjustable airspace can replace an impractically thin solid glass plate.

### Source coverage

- Page 437 gives the resonance condition $\lambda=\lambda_0/n=2l/m$.
- The adjacent-order calculation starts from $\lambda_{m-1}-\lambda_m=2l/(m-1)-2l/m$.
- Equation (43a) gives $$\Delta\lambda_f\doteq\frac{\lambda^2}{2l}.$$
- Equation (43b) gives $$\Delta\lambda_{f0}\doteq\frac{\lambda_0^2}{2nl}.$$
- For $\lambda_0=600$ nm, $\Delta\lambda_{s0}=50$ nm, and $n=1.45$, the example obtains $l<2.5\ \mu\mathrm{m}$.
- The source proposes an adjustable airspace between thick, antireflection-coated plates.
