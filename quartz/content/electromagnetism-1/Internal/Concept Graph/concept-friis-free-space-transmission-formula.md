---
title: "Friis Free-Space Transmission Formula"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "friis-free-space-transmission-formula"
locations: ["Page 563", "Page 567, Problem 14.28", "Pages 567-568, Problem 14.29"]
related: ["antenna-effective-area-and-directivity", "antenna-reciprocity-and-link-reversal", "dipole-radiation-patterns-and-directivity"]
---

## ConceptNode: Friis Free-Space Transmission Formula

Planning node for [[friis-free-space-transmission-formula|1.335 Friis Free-Space Transmission Formula]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 563, Page 567, Problem 14.28, Pages 567-568, Problem 14.29

The Friis formula connects total power radiated by a transmitting antenna to power delivered to the matched load of a receiving antenna. In effective-area form, the source gives $$\frac{P_{L2}}{P_{r1}}=\frac{A_{e1}(\theta_1,\phi_1)A_{e2}(\theta_2,\phi_2)}{\lambda^2r^2}.$$ Using $A_e=\lambda^2D/(4\pi)$ yields the equivalent directivity form $$\frac{P_{L2}}{P_{r1}}=\frac{\lambda^2}{(4\pi r)^2}D_1(\theta_1,\phi_1)D_2(\theta_2,\phi_2).$$ Here $P_{r1}$ is total radiated transmitter power, $P_{L2}$ is power dissipated in the receiving load, $r$ is antenna separation, $\lambda$ is wavelength, and the directional directivities are evaluated along the propagation directions relevant to the link. The $1/r^2$ dependence represents spherical spreading, while the product of antenna properties accounts for directional concentration and reception. The formula assumes lossless antennas, mutual far-zone placement, and a conjugate-matched receiving load. The chapter exercises use it in both forward and reverse links and in links involving half-wave dipoles, rotated antennas, known apertures, and directivities stated in decibels.

### Key planning details

- Effective-area form: $P_{L2}/P_{r1}=A_{e1}A_{e2}/(\lambda^2r^2)$.
- Directivity form: $P_{L2}/P_{r1}=\lambda^2D_1D_2/(4\pi r)^2$.
- Received power decreases as $1/r^2$.
- Both antenna factors must be evaluated in the link directions.
- The stated formula assumes lossless antennas in each other's far zones.
- The receiving load must be conjugate-matched to the antenna impedance.

### Source coverage

- Equation (105) gives both the mixed effective-area/directivity expression and the effective-area product.
- Equation (106) gives the directivity-product form.
- The text explicitly states the assumptions of lossless antennas, far-zone separation, and a conjugate-matched receiving load.
- D14.11 uses a $1\ \mathrm{m^2}$ receiving effective area, $1$ mW load power, $1.0$ km range, and transmitter directivities of 10 dB and 7 dB.
- Problem 14.29 specifies two identical half-wave dipoles, wavelength 1 m, separation 1 km, and transmitter power 100 W.
