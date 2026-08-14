---
title: "Half-Wave Matching"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "half-wave-matching"
locations: ["Page 435", "Page 436", "Section 12.3.3: Special Cases: Half-Wave and Quarter-Wave Layers"]
related: ["input-impedance-net-slab-reflection", "refractive-index-material-wave-parameters", "fabry-perot-resonance-free-spectral-range", "quarter-wave-matching-antireflection-coatings"]
---

## ConceptNode: Half-Wave Matching

Planning node for [[half-wave-matching|1.254 Half-Wave Matching]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 435, Page 436, Section 12.3.3: Special Cases: Half-Wave and Quarter-Wave Layers

Total transmission through a lossless slab occurs when its input impedance equals the impedance of the incident medium, since this makes $\Gamma=0$. One way to achieve this is half-wave matching. If the outer media have equal impedances, $\eta_3=\eta_1$, and the slab phase thickness satisfies $\beta_2l=m\pi$, then its physical thickness is an integer number of half-wavelengths: $l=m\lambda_2/2$. Under this condition, the input impedance reduces to $\eta_{\mathrm{in}}=\eta_3$. The intermediate layer therefore becomes immaterial to the input reflection result, and the system behaves like a single interface between regions 1 and 3. If those regions are impedance matched, no net reflected wave remains. The source identifies aircraft radomes as an application: an antenna can transmit and receive through a suitably designed dielectric part of the fuselage while retaining an aerodynamic shape. Half-wave matching is wavelength selective. Departing from the design wavelength changes the electrical thickness and increases reflection, so the structure behaves as a bandpass transmission device rather than as a broadband match.

### Key planning details

- Total transmission requires $\Gamma=0$ and therefore $\eta_{\mathrm{in}}=\eta_1$.
- Half-wave matching assumes $\eta_3=\eta_1$.
- The phase condition is $\beta_2l=m\pi$.
- The corresponding thickness is $l=m\lambda_2/2$.
- At a multiple half-wave thickness, $\eta_{\mathrm{in}}=\eta_3$.
- The layer becomes reflection-equivalent to direct contact between regions 1 and 3.
- The match degrades as wavelength departs from its design value.

### Source coverage

- Equation (37) derives $$l=m\frac{\lambda_2}{2}$$ from $\beta_2=2\pi/\lambda_2$ and $\beta_2l=m\pi$.
- Page 435 states that total transmission occurs when $\eta_{\mathrm{in}}=\eta_1$.
- Page 436 states that a multiple half-wave thickness renders region 2 immaterial to reflection and transmission results.
- Page 436 identifies antenna housings called radomes as an application.
- The source states that reflectivity increases with deviation from the matching wavelength, giving a bandpass-filter response.
