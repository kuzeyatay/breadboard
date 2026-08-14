---
title: "1.256 Fabry-Perot Resonance and Free Spectral Range"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 436", "Page 437", "Section 12.3.3: Special Cases: Half-Wave and Quarter-Wave Layers"]
related: ["half-wave-matching", "refractive-index-material-wave-parameters", "quarter-wave-matching-antireflection-coatings", "frequency-dependent-refractive-index-angular-dispersion"]
---

# 1.256 Fabry-Perot Resonance and Free Spectral Range

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 436, Page 437, Section 12.3.3: Special Cases: Half-Wave and Quarter-Wave Layers

A simple Fabry-Perot interferometer can be modeled as a transparent slab whose thickness supports half-wave transmission resonances. For a slab of index $n$ and thickness $l$, transmitted wavelengths satisfy $\lambda=\lambda_0/n=2l/m$, where $m$ is the number of half-wavelengths inside the material. Several integer orders can therefore be transmitted. To isolate one desired wavelength, adjacent resonant wavelengths must be separated farther than the input spectrum's width. Subtracting neighboring resonance wavelengths gives the approximate free spectral range inside the material, $\Delta\lambda_f\approx\lambda^2/(2l)$. Expressed using free-space wavelength, it becomes $\Delta\lambda_{f0}\approx\lambda_0^2/(2nl)$. A narrow-band filter can isolate one order when the spectrum being filtered is narrower than this free spectral range. The worked example applies that criterion to a 600 nm spectrum with 50 nm full width and glass index 1.45, obtaining $l<2.5\ \mu\mathrm{m}$. Because such a thin glass plate is impractical, the source describes an adjustable air gap between thicker antireflection-coated plates as a more useful implementation.

## Page-Grounded Details

#### Page 436

the results on reflection and transmission. Equivalently, we have a single-interface problem involving $\eta_{1}$ and $\eta_{3}$. Now, with $\eta_{3} = \eta_{1}$, we have a matched input impedance, and there is no net reflected wave. This method of choosing the region 2 thickness is known as half-wave matching. Its applications include, for example, antenna housings on airplanes known as radomes, which form a part of the fuselage. The antenna, inside the aircraft, can transmit and receive through this layer, which can be shaped to enable good aerodynamic characteristics. Note that the half-wave matching condition no longer applies as we deviate from the wavelength that satisfies it. When this is done, the device reflectivity increases (with increased wavelength deviation), so it ultimately acts as a bandpass filter.

Often, it is convenient to express the dielectric constant of the medium through the refractive index (or just index), n, defined as
$$
n = \sqrt{\epsilon_{r}}\quad{(38)}
$$
Characterizing materials by their refractive indices is primarily done at optical frequencies (on the order of $10^{14}$ Hz), whereas at much lower frequencies, a dielectric constant is t

[Truncated for analysis]

#### Page 437

material of index n, whose thickness, l, is set to transmit wavelengths which satisfy the condition $\lambda=\lambda_{0}/n=2l/m$. Often we want to transmit only one wavelength, not several, as (37) would allow. We would therefore like to assure that adjacent wave-lengths that are passed through the device are separated as far as possible, so that only one will lie within the input power spectrum. In terms of wavelength as measured in the material, this separation is in general given by
$$
\lambda_{m-1}-\lambda_{m}=\Delta\lambda_{f}=\frac{2l}{m-1}-\frac{2l}{m}=\frac{2l}{m(m-1)}\doteq\frac{2l}{m^{2}}
$$
Note that m is the number of half-wavelengths in region 2, or $m=2l/\lambda=2nl/\lambda_{0}$,where $\lambda_{0}$ is the desired free-space wavelength for transmission. Thus
$$
\Delta\lambda_{f}\doteq\frac{\lambda_{2}^{2}}{2l}\quad{(43a)}
$$
In terms of wavelength measured in free space, this becomes
$$
\Delta\lambda_{f0}=n\Delta\lambda_{f}\doteq\frac{\lambda_{0}^{2}}{2nl}\quad{(43b)}
$$
$\Delta\lambda_{f0}$ is known as the free spectral range of the Fabry-Perot interferometer in terms of free-space wavelength separation. The interferometer can be used as a narrow-band fi

[Truncated for analysis]

## Core Ideas

- Fabry-Perot transmission orders satisfy $\lambda=2l/m$ inside the material.
- The order number is $m=2l/\lambda=2nl/\lambda_0$.
- Adjacent resonances are separated by $\Delta\lambda_f\approx\lambda^2/(2l)$.
- The free-space free spectral range is $\Delta\lambda_{f0}\approx\lambda_0^2/(2nl)$.
- Single-order filtering requires the input spectral width to be smaller than the free spectral range.
- Reducing cavity thickness increases the free spectral range.
- An adjustable airspace can replace an impractically thin solid glass plate.

## Source Anchors

- Page 437 gives the resonance condition $\lambda=\lambda_0/n=2l/m$.
- The adjacent-order calculation starts from $\lambda_{m-1}-\lambda_m=2l/(m-1)-2l/m$.
- Equation (43a) gives
$$
\Delta\lambda_f\doteq\frac{\lambda^2}{2l}
$$
- Equation (43b) gives
$$
\Delta\lambda_{f0}\doteq\frac{\lambda_0^2}{2nl}
$$
- For $\lambda_0=600$ nm, $\Delta\lambda_{s0}=50$ nm, and $n=1.45$, the example obtains $l<2.5\ \mu\mathrm{m}$.
- The source proposes an adjustable airspace between thick, antireflection-coated plates.

## Related Pages

- [[half-wave-matching|Half-Wave Matching]]
- [[refractive-index-material-wave-parameters|Refractive Index and Material Wave Parameters]]
- [[quarter-wave-matching-antireflection-coatings|Quarter-Wave Matching and Antireflection Coatings]]
- [[frequency-dependent-refractive-index-angular-dispersion|Frequency-Dependent Refractive Index and Angular Dispersion]]

## Concept Dependencies

- depends-on: [[half-wave-matching|Half-Wave Matching]]
- depends-on: [[refractive-index-material-wave-parameters|Refractive Index and Material Wave Parameters]]
