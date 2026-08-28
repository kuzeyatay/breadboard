---
title: "Lossless Dielectric Plane-Wave Propagation"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "lossless-dielectric-plane-wave-propagation"
locations: ["Page 392", "Page 393"]
related: ["fresh-water-plane-wave-calculation", "microwave-absorption-and-penetration-in-water", "poynting-vector-and-electromagnetic-energy-conservation", "linear-polarization-and-orthogonal-field-decomposition"]
---

## ConceptNode: Lossless Dielectric Plane-Wave Propagation

Planning node for [[lossless-dielectric-plane-wave-propagation|1.222 Lossless Dielectric Plane-Wave Propagation]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 392, Page 393

A uniform plane wave in a general lossy medium has a propagation constant with attenuation coefficient $\alpha$ and phase constant $\beta$, and its wavelength is defined by $\lambda=2\pi/\beta$. The magnetic-field phasor is related to the electric-field phasor through the intrinsic impedance $\eta$, which is complex when the permittivity has a nonzero imaginary part. In the special case of a lossless medium, $\epsilon''=0$, so $\alpha=0$ and $\beta=\omega\sqrt{\mu\epsilon'}$. The real electric field then has the traveling-wave form $E_x=E_{x0}\cos(\omega t-\beta z)$. Its phase velocity is $v_p=\omega/\beta=1/\sqrt{\mu\epsilon'}$, and its wavelength is $\lambda=1/(f\sqrt{\mu\epsilon'})$. Expressed relative to free space, $v_p=c/\sqrt{\mu_r\epsilon'_r}$ and $\lambda=\lambda_0/\sqrt{\mu_r\epsilon'_r}$. The corresponding magnetic field is $H_y=(E_{x0}/\eta)\cos(\omega t-\beta z)$, with real intrinsic impedance $\eta=\sqrt{\mu/\epsilon'}$. Thus $\mathbf{E}$, $\mathbf{H}$, and the propagation direction are mutually perpendicular, and the electric and magnetic fields are in phase.

### Key planning details

- Wavelength is defined by $\lambda=2\pi/\beta$.
- A lossless dielectric satisfies $\epsilon''=0$ and therefore $\alpha=0$.
- The lossless-medium phase constant is $\beta=\omega\sqrt{\mu\epsilon'}$.
- The phase velocity is $v_p=1/\sqrt{\mu\epsilon'}=c/\sqrt{\mu_r\epsilon'_r}$.
- The wavelength is $\lambda=\lambda_0/\sqrt{\mu_r\epsilon'_r}$.
- The intrinsic impedance is real: $\eta=\sqrt{\mu/\epsilon'}$.
- The vectors $\mathbf{E}$ and $\mathbf{H}$ are perpendicular to each other and to the propagation direction.
- For positive $z$ propagation, $\mathbf{E}\times\mathbf{H}$ points in the positive $z$ direction.

### Source coverage

- Equation (47) defines $\lambda=2\pi/\beta$.
- Equation (48) gives $\eta=\sqrt{\mu/(\epsilon'-j\epsilon'')}$ for a lossy medium.
- Equations (49) and (50) give $\beta=\omega\sqrt{\mu\epsilon'}$ and $E_x=E_{x0}\cos(\omega t-\beta z)$ when $\epsilon''=0$.
- Equation (51) gives $\lambda=c/(f\sqrt{\mu_r\epsilon'_r})=\lambda_0/\sqrt{\mu_r\epsilon'_r}$.
- Equation (52) identifies the lossless intrinsic impedance as $\eta=\sqrt{\mu/\epsilon'}$.
- Page 393 states that the two fields are mutually perpendicular, perpendicular to propagation, and in phase.
