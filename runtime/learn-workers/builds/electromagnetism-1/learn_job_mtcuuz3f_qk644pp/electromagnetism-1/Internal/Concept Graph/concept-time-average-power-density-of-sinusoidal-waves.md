---
title: "Time-Average Power Density of Sinusoidal Waves"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "time-average-power-density-of-sinusoidal-waves"
locations: ["Page 400", "Page 401"]
related: ["poynting-vector-and-electromagnetic-energy-conservation", "microwave-absorption-and-penetration-in-water", "good-conductor-intrinsic-impedance-and-power-density", "linear-polarization-and-orthogonal-field-decomposition", "lossless-dielectric-plane-wave-propagation"]
---

## ConceptNode: Time-Average Power Density of Sinusoidal Waves

Planning node for [[time-average-power-density-of-sinusoidal-waves|1.228 Time-Average Power Density of Sinusoidal Waves]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 400, Page 401

For a plane wave propagating in the positive $z$ direction, an $x$-directed electric field and $y$-directed magnetic field produce $\mathbf{E}\times\mathbf{H}$ in the positive $z$ direction. In a perfect dielectric, the fields are in phase, so the instantaneous power density is $S_z=(E_{x0}^2/\eta)\cos^2(\omega t-\beta z)$. In a lossy dielectric, both fields decay as $e^{-\alpha z}$ and differ in phase because $\eta=|\eta|\angle\theta_\eta$. Their product contains both a time-varying second-harmonic term and a constant term. Averaging over one period eliminates the second-harmonic contribution and gives $\langle S_z\rangle=(1/2)(E_{x0}^2/|\eta|)e^{-2\alpha z}\cos\theta_\eta$. Power density therefore decays twice as rapidly in the exponent as either field amplitude. The same result follows compactly from phasors through $\langle\mathbf{S}\rangle=(1/2)\operatorname{Re}(\mathbf{E}_s\times\mathbf{H}_s^*)$. This expression applies to any sinusoidal electromagnetic wave and provides both the magnitude and direction of its time-average power density.

### Key planning details

- Instantaneous power density is the Poynting vector $\mathbf{E}\times\mathbf{H}$.
- In a lossless dielectric, $S_z=(E_{x0}^2/\eta)\cos^2(\omega t-\beta z)$.
- A complex intrinsic impedance introduces an electric-to-magnetic phase difference.
- Averaging over one period removes the second-harmonic term.
- The lossy-wave average is $\langle S_z\rangle=(E_{x0}^2/(2|\eta|))e^{-2\alpha z}\cos\theta_\eta$.
- Field amplitudes decay as $e^{-\alpha z}$, while power density decays as $e^{-2\alpha z}$.
- The general phasor formula is $\langle\mathbf{S}\rangle=(1/2)\operatorname{Re}(\mathbf{E}_s\times\mathbf{H}_s^*)$.

### Source coverage

- Page 400 demonstrates $E_x\mathbf{a}_x\times H_y\mathbf{a}_y=S_z\mathbf{a}_z$.
- The lossy fields are written with amplitude factor $e^{-\alpha z}$ and impedance angle $\theta_\eta$.
- The product-to-sum identity is used to average the instantaneous power over one cycle.
- Equation (76) gives $\langle S_z\rangle=(1/2)(E_{x0}^2/|\eta|)e^{-2\alpha z}\cos\theta_\eta$.
- Equation (77) gives the general phasor expression for time-average power density.
- Exercise D11.6 asks for average power in ice at three frequencies and two propagation depths.
