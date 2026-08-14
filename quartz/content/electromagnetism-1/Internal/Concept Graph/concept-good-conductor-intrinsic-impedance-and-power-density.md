---
title: "Good-Conductor Intrinsic Impedance and Power Density"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "good-conductor-intrinsic-impedance-and-power-density"
locations: ["Page 405", "Page 406"]
related: ["good-conductor-propagation-approximation", "skin-depth-and-field-confinement", "time-average-power-density-of-sinusoidal-waves", "skin-effect-resistance"]
---

## ConceptNode: Good-Conductor Intrinsic Impedance and Power Density

Planning node for [[good-conductor-intrinsic-impedance-and-power-density|1.232 Good-Conductor Intrinsic Impedance and Power Density]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 405, Page 406

For a good conductor, the general impedance $\eta=\sqrt{j\omega\mu/(\sigma+j\omega\epsilon')}$ simplifies because $\sigma\gg\omega\epsilon'$. Using the skin depth, the result is $\eta=(1+j)/(\sigma\delta)=\sqrt{2}\angle45^\circ/(\sigma\delta)$. The electric field inside the conductor is $E_x=E_{x0}e^{-z/\delta}\cos(\omega t-z/\delta)$. Dividing by the complex impedance gives $H_y=(\sigma\delta E_{x0}/\sqrt{2})e^{-z/\delta}\cos(\omega t-z/\delta-\pi/4)$. Thus the magnetic-field maximum occurs one-eighth cycle later than the electric-field maximum at every point. Applying the time-average phasor Poynting-vector formula yields $\langle S_z\rangle=(1/4)\sigma\delta E_{x0}^2e^{-2z/\delta}$. This power flows into the conductor and is converted into ohmic heat. Like the general lossy-medium result, the power density has twice the exponential attenuation rate of either field. After one skin depth, it is only $e^{-2}=0.135$ of its value at the surface.

### Key planning details

- The good-conductor impedance is $\eta=(1+j)/(\sigma\delta)$.
- Its phase is $45^\circ$.
- Both electric and magnetic fields decay as $e^{-z/\delta}$.
- The magnetic field lags the electric field by $\pi/4$.
- A $\pi/4$ phase difference equals one-eighth of a cycle.
- The average power density is $\langle S_z\rangle=(1/4)\sigma\delta E_{x0}^2e^{-2z/\delta}$.
- Power density falls to $0.135$ of its surface value after one skin depth.

### Source coverage

- Equation (85) gives $\eta=\sqrt{2}\angle45^\circ/(\sigma\delta)=(1+j)/(\sigma\delta)$.
- Equation (86) expresses the electric field in terms of skin depth.
- Equation (87) gives the magnetic field with phase delay $\pi/4$.
- Page 406 states that the magnetic-field maximum occurs one-eighth cycle after the electric-field maximum.
- The derived average Poynting vector is $\langle S_z\rangle=(1/4)\sigma\delta E_{x0}^2e^{-2z/\delta}$.
- The source again identifies the one-skin-depth power factor as $e^{-2}=0.135$.
