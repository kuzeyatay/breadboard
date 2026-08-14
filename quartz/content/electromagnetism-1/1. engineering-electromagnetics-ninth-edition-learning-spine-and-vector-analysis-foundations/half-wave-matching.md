---
title: "1.254 Half-Wave Matching"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 435", "Page 436", "Section 12.3.3: Special Cases: Half-Wave and Quarter-Wave Layers"]
related: ["input-impedance-net-slab-reflection", "refractive-index-material-wave-parameters", "fabry-perot-resonance-free-spectral-range", "quarter-wave-matching-antireflection-coatings"]
---

# 1.254 Half-Wave Matching

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 435, Page 436, Section 12.3.3: Special Cases: Half-Wave and Quarter-Wave Layers

Total transmission through a lossless slab occurs when its input impedance equals the impedance of the incident medium, since this makes $\Gamma=0$. One way to achieve this is half-wave matching. If the outer media have equal impedances, $\eta_3=\eta_1$, and the slab phase thickness satisfies $\beta_2l=m\pi$, then its physical thickness is an integer number of half-wavelengths: $l=m\lambda_2/2$. Under this condition, the input impedance reduces to $\eta_{\mathrm{in}}=\eta_3$. The intermediate layer therefore becomes immaterial to the input reflection result, and the system behaves like a single interface between regions 1 and 3. If those regions are impedance matched, no net reflected wave remains. The source identifies aircraft radomes as an application: an antenna can transmit and receive through a suitably designed dielectric part of the fuselage while retaining an aerodynamic shape. Half-wave matching is wavelength selective. Departing from the design wavelength changes the electrical thickness and increases reflection, so the structure behaves as a bandpass transmission device rather than as a broadband match.

## Page-Grounded Details

#### Page 435

and (34b) together, eliminating $E_{xs2}$, to obtain
$$
\frac{E_{x10}^{-}}{E_{x10}^{+}}=\Gamma=\frac{\eta_{\rm in}-\eta_{1}}{\eta_{\rm in}+\eta_{1}}\quad{(35)}
$$
To find the input impedance, we evaluate (32) at $z=-l$, resulting in
$$
\eta_{\rm in}=\eta_{2}\frac{\eta_{3}\cos\beta_{2}l}{\eta_{2}\cos\beta_{2}l+j\eta_{3}\sin\beta_{2}l}\quad{(36)}
$$
Equations (35) and (36) are general results that enable us to calculate the net reflected wave amplitude and phase from two parallel interfaces between lossless media.^1 Note the dependence on the interface spacing, $l$, and on the wavelength as measured in region 2, characterized by $\beta_{2}$. Of immediate importance to us is the fraction of the incident power that reflects from the dual interface and back-propagates in region 1. As we found earlier, this fraction will be $|\Gamma|^{2}$. Also of interest is the transmitted power, which propagates away from the second interface in region 3. It is simply the remaining power fraction, which is $1-|\Gamma|^{2}$. The power in region 2 stays constant in steady state; power leaves that region to form the reflected and transmitted waves, but is immediately replenished by the in

[Truncated for analysis]

#### Page 436

the results on reflection and transmission. Equivalently, we have a single-interface problem involving $\eta_{1}$ and $\eta_{3}$. Now, with $\eta_{3} = \eta_{1}$, we have a matched input impedance, and there is no net reflected wave. This method of choosing the region 2 thickness is known as half-wave matching. Its applications include, for example, antenna housings on airplanes known as radomes, which form a part of the fuselage. The antenna, inside the aircraft, can transmit and receive through this layer, which can be shaped to enable good aerodynamic characteristics. Note that the half-wave matching condition no longer applies as we deviate from the wavelength that satisfies it. When this is done, the device reflectivity increases (with increased wavelength deviation), so it ultimately acts as a bandpass filter.

Often, it is convenient to express the dielectric constant of the medium through the refractive index (or just index), n, defined as
$$
n = \sqrt{\epsilon_{r}}\quad{(38)}
$$
Characterizing materials by their refractive indices is primarily done at optical frequencies (on the order of $10^{14}$ Hz), whereas at much lower frequencies, a dielectric constant is t

[Truncated for analysis]

## Core Ideas

- Total transmission requires $\Gamma=0$ and therefore $\eta_{\mathrm{in}}=\eta_1$.
- Half-wave matching assumes $\eta_3=\eta_1$.
- The phase condition is $\beta_2l=m\pi$.
- The corresponding thickness is $l=m\lambda_2/2$.
- At a multiple half-wave thickness, $\eta_{\mathrm{in}}=\eta_3$.
- The layer becomes reflection-equivalent to direct contact between regions 1 and 3.
- The match degrades as wavelength departs from its design value.

## Source Anchors

- Equation (37) derives
$$
l=m\frac{\lambda_2}{2}
$$
 from $\beta_2=2\pi/\lambda_2$ and $\beta_2l=m\pi$.
- Page 435 states that total transmission occurs when $\eta_{\mathrm{in}}=\eta_1$.
- Page 436 states that a multiple half-wave thickness renders region 2 immaterial to reflection and transmission results.
- Page 436 identifies antenna housings called radomes as an application.
- The source states that reflectivity increases with deviation from the matching wavelength, giving a bandpass-filter response.

## Related Pages

- [[input-impedance-net-slab-reflection|Input Impedance and Net Slab Reflection]]
- [[refractive-index-material-wave-parameters|Refractive Index and Material Wave Parameters]]
- [[fabry-perot-resonance-free-spectral-range|Fabry-Perot Resonance and Free Spectral Range]]
- [[quarter-wave-matching-antireflection-coatings|Quarter-Wave Matching and Antireflection Coatings]]

## Concept Dependencies

- applies-to: [[input-impedance-net-slab-reflection|Input Impedance and Net Slab Reflection]]
- related: [[fabry-perot-resonance-free-spectral-range|Fabry-Perot Resonance and Free Spectral Range]]
