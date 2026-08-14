---
title: "Phase Velocity and Wavelength in Lossy Media"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "phase-velocity-and-wavelength-in-lossy-media"
locations: ["Page 390", "Page 391"]
related: ["lossy-dielectric-propagation-and-complex-wavenumber", "complex-permittivity-and-dielectric-loss", "traveling-wave-direction-and-sinusoidal-solutions"]
---

## ConceptNode: Phase Velocity and Wavelength in Lossy Media

Planning node for [[phase-velocity-and-wavelength-in-lossy-media|1.221 Phase Velocity and Wavelength in Lossy Media]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 390, Page 391

Even when a dielectric attenuates a wave, the phase motion is controlled by the phase constant $\beta$. In the instantaneous field $E_x=E_{x0}e^{-\alpha z}\cos(\omega t-\beta z)$, holding a point of constant phase requires $\omega t-\beta z$ to remain fixed. Differentiating that condition gives the phase velocity $v_p=\omega/\beta$. The wavelength is the distance over which the spatial phase advances by $2\pi$, so $\beta\lambda=2\pi$ and therefore $\lambda=2\pi/\beta$. Because the exact expression for $\beta$ contains both $\epsilon'$ and $\epsilon''$, dielectric loss can alter phase velocity and wavelength as well as amplitude. This distinguishes $\beta$, which measures spatial phase accumulation in radians per meter, from $\alpha$, which measures exponential amplitude reduction in nepers per meter. The two quantities jointly describe propagation through the complex constant $jk=\alpha+j\beta$.

### Key planning details

- Phase velocity in a lossy medium is $v_p=\omega/\beta$.
- Wavelength satisfies $\beta\lambda=2\pi$.
- Therefore $\lambda=2\pi/\beta$.
- The attenuation coefficient $\alpha$ controls amplitude decay.
- The phase constant $\beta$ controls spatial phase accumulation.
- Complex permittivity can change both attenuation and phase propagation.
- The pair $\alpha$ and $\beta$ fully separates amplitude and phase effects in the propagation factor.

### Source coverage

- Equation (41) displays the phase as $\omega t-\beta z$ and the attenuation factor as $e^{-\alpha z}$.
- Equation (45) makes $\beta$ depend on $\epsilon''/\epsilon'$ as well as $\mu\epsilon'$.
- Equation (46) gives $v_p=\omega/\beta$.
- Page 391 states that wavelength is the distance required for a $2\pi$ phase change and gives $\beta\lambda=2\pi$.
- The source explicitly notes that $\epsilon''$ affects phase constant, wavelength, and phase velocity.
