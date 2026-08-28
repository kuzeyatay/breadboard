---
title: "Below-Cutoff Evanescent Fields"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "below-cutoff-evanescent-fields"
locations: ["Page 488, Equations (50) through (52)"]
related: ["parallel-plate-mode-propagation-and-cutoff", "te-mode-fields-from-plane-wave-superposition", "phase-and-group-velocities-in-a-waveguide"]
---

## ConceptNode: Below-Cutoff Evanescent Fields

Planning node for [[below-cutoff-evanescent-fields|1.275 Below-Cutoff Evanescent Fields]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 488, Equations (50) through (52)

When the operating frequency falls below a mode's cutoff, the axial phase constant becomes imaginary rather than real. Writing $\beta_m=-j\alpha_m$ converts the propagation factor $e^{-j\beta_m z}$ into the decaying factor $e^{-\alpha_m z}$. The TE field then has the form $$E_{ys}=E_0'\sin(\kappa_m x)e^{-\alpha_m z},$$ or instantaneously, $$E_y(x,z,t)=E_0'\sin(\kappa_m x)e^{-\alpha_m z}\cos(\omega t).$$ This field oscillates in time but does not carry a phase pattern progressively down the guide. Its amplitude decreases exponentially with increasing $z$. The attenuation coefficient is $$\alpha_m=\frac{n\omega_{cm}}{c}\sqrt{1-\left(\frac{\omega}{\omega_{cm}}\right)^2}=\frac{2\pi n}{\lambda_{cm}}\sqrt{1-\left(\frac{\lambda_{cm}}{\lambda}\right)^2}.$$ The result provides the physical meaning of cutoff: below cutoff, the mode can exist locally as an evanescent field but cannot propagate as a guided traveling mode.

### Key planning details

- Below cutoff, $\omega<\omega_{cm}$.
- The axial phase constant is written $\beta_m=-j\alpha_m$.
- The axial field dependence becomes $e^{-\alpha_m z}$.
- The field continues to oscillate at angular frequency $\omega$.
- There is no progressive axial phase term below cutoff.
- $\alpha_m$ quantifies exponential decay per unit axial distance.
- The transverse sine profile remains present below cutoff.

### Source coverage

- Equations (50) and (51) give the phasor and instantaneous TE fields below cutoff.
- The source states that the mode does not propagate and decreases in strength with increasing $z$.
- Equation (52) gives $\alpha_m$ in frequency and wavelength forms.
