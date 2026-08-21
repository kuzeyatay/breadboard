---
title: "Sinusoidal Phase Propagation and Wavelength"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "sinusoidal-phase-propagation-and-wavelength"
locations: ["Page 323", "Page 324", "Section 10.4: Lossless Propagation of Sinusoidal Voltages"]
related: ["lossless-traveling-wave-solutions", "characteristic-impedance-and-wave-current-direction", "distributed-versus-lumped-circuit-models"]
---

## ConceptNode: Sinusoidal Phase Propagation and Wavelength

Planning node for [[sinusoidal-phase-propagation-and-wavelength|1.168 Sinusoidal Phase Propagation and Wavelength]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 323, Page 324, Section 10.4: Lossless Propagation of Sinusoidal Voltages

A practical signal can be decomposed into sinusoidal frequency components, propagated according to the line's frequency-dependent behavior, and recombined in the time domain. For a single frequency $f=\omega/(2\pi)$, the real instantaneous voltage has the form $$\mathcal{V}(z,t)=|V_0|\cos(\omega t\pm\beta z+\phi).$$ The minus sign gives forward propagation, $\mathcal{V}_f=|V_0|\cos(\omega t-\beta z)$, and the plus sign gives backward propagation, $\mathcal{V}_b=|V_0|\cos(\omega t+\beta z)$. The phase constant is $$\beta=\frac{\omega}{v_p},$$ where $v_p$ is phase velocity. While $\omega$ measures phase change per unit time in rad/s, $\beta$ measures phase change per unit distance in rad/m. One spatial cycle requires $\beta\lambda=2\pi$, so $$\lambda=\frac{2\pi}{\beta}=\frac{v_p}{f}.$$

### Key planning details

- Sinusoidal components form the basis of frequency-domain line analysis.
- Forward propagation uses phase $\omega t-\beta z$.
- Backward propagation uses phase $\omega t+\beta z$.
- Phase constant is $\beta=\omega/v_p$ in rad/m.
- Wavelength is $\lambda=2\pi/\beta=v_p/f$.

### Source coverage

- Page 323 motivates sinusoidal analysis through decomposition and reconstruction of practical signals.
- Equation (26) on Page 324 gives the sinusoidal voltage with phase velocity and phase constant.
- Equations (27a) and (27b) distinguish forward and backward instantaneous voltage waves.
- Equation (28) defines $\beta=\omega/v_p$.
- Equations (29) and (30) identify spatial periodicity and $\lambda=2\pi/\beta=v_p/f$.
