---
title: "Transverse Resonance and Mode Quantization"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "transverse-resonance-and-mode-quantization"
locations: ["Page 484, Section 13.3.2", "Page 485, Figure 13.15", "Page 486, Figure 13.16", "Page 490, Problem D13.5"]
related: ["plane-wave-model-of-guided-modes", "parallel-plate-mode-propagation-and-cutoff", "parallel-plate-wave-equation-eigenmodes"]
---

## ConceptNode: Transverse Resonance and Mode Quantization

Planning node for [[transverse-resonance-and-mode-quantization|1.271 Transverse Resonance and Mode Quantization]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 484, Section 13.3.2, Page 485, Figure 13.15, Page 486, Figure 13.16, Page 490, Problem D13.5

Transverse resonance converts the qualitative phase-coincidence requirement into a quantitative mode condition. During one round trip across a plate spacing $d$, the wave accumulates transverse propagation phase $\kappa_m d$ in each direction and reflection phase $\phi$ at each conductor. The required total phase is an integer multiple of $2\pi$: $$\kappa_m d+\phi+\kappa_m d+\phi=2m\pi.$$ For TE reflection, $\phi=\pi$, while for TM reflection, $\phi=0$. Over two reflections these contribute $2\pi$ or zero, so they do not alter the resulting quantization condition. Both mode families therefore satisfy $$\kappa_m=\frac{m\pi}{d}.$$ Since $\kappa_m=k\cos\theta_m$ and $k=\omega n/c$, the permitted wave angles are $$\theta_m=\cos^{-1}\left(\frac{m\pi}{kd}\right)=\cos^{-1}\left(\frac{m\pi c}{\omega nd}\right)=\cos^{-1}\left(\frac{m\lambda}{2nd}\right).$$ This derivation explains why only discrete transverse field patterns and ray angles can persist in the guide.

### Key planning details

- Transverse resonance requires a round-trip phase shift of $2m\pi$.
- Each one-way transverse propagation contributes $\kappa_m d$ radians.
- Each conductor reflection contributes phase $\phi$.
- TE and TM reflection phases differ, but their round-trip contributions do not change the final quantization.
- The allowed transverse constants are $\kappa_m=m\pi/d$.
- The allowed angle satisfies $\cos\theta_m=m\lambda/(2nd)$.
- Increasing $m$ increases the required transverse phase variation.

### Source coverage

- Figure 13.15 divides the round trip into upward traversal, top reflection, downward traversal, and bottom reflection.
- Equation (37) states $\kappa_m d+\phi+\kappa_m d+\phi=2m\pi$.
- Equation (38) gives $\kappa_m=m\pi/d$ for both TE and TM modes.
- Equation (39) gives the allowed angle in terms of $k$, $\omega$, $n$, $d$, and free-space wavelength $\lambda$.
- Problem D13.5 reports the first four angles as $76^\circ$, $60^\circ$, $41^\circ$, and $0^\circ$ for the stated air-filled guide.
