---
title: "Plane-Wave Field and Power Analysis Procedures"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "plane-wave-field-and-power-analysis-procedures"
locations: ["Page 415, Problems 11.1 through 11.3", "Page 416, Problems 11.4 through 11.9", "Page 417, Problems 11.10 through 11.16", "Page 418, Problems 11.17 through 11.24", "Page 419, Problems 11.25 through 11.29", "Page 420, Problem 11.33"]
related: ["loss-penetration-depth-and-conductor-power-dissipation", "circularly-polarized-wave-phasors", "incident-reflected-and-transmitted-plane-waves", "power-reflectivity-and-conservation"]
---

## ConceptNode: Plane-Wave Field and Power Analysis Procedures

Planning node for [[plane-wave-field-and-power-analysis-procedures|1.242 Plane-Wave Field and Power Analysis Procedures]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 415, Problems 11.1 through 11.3, Page 416, Problems 11.4 through 11.9, Page 417, Problems 11.10 through 11.16, Page 418, Problems 11.17 through 11.24, Page 419, Problems 11.25 through 11.29, Page 420, Problem 11.33

The Chapter 11 problem set consolidates a reusable workflow for uniform plane-wave analysis. Given frequency and medium parameters, the solver determines phase velocity, propagation constant, wavelength, intrinsic impedance, electric and magnetic phasors, and time-average Poynting vector. Propagation direction and electric-field orientation determine the magnetic-field direction through the right-handed relation among $\mathbf{E}$, $\mathbf{H}$, and the direction of power flow. In a lossy medium, attenuation $e^{-\alpha z}$ and phase variation $e^{-j\beta z}$ must both be retained, and a complex intrinsic impedance creates a phase difference between electric and magnetic fields. The tasks also apply power density to finite receiving areas, spherical surfaces, coaxial cross sections, and focused beams. Other problems reverse the process by using measured $k$ and $\eta$ to infer $\mu$, $\epsilon'$, and $\epsilon''$, or use Maxwell's equations to verify nonuniform and cylindrical field forms.

### Key planning details

- Compute $v_p$, $\beta$, and $\lambda$ from frequency and material properties.
- Use propagation direction and polarization to construct $\mathbf{E}_s$ and $\mathbf{H}_s$.
- Retain both attenuation and phase factors in lossy media.
- Use $\langle\mathbf{S}\rangle=(1/2)\operatorname{Re}\{\mathbf{E}_s\times\mathbf{H}_s^*\}$ for average power density.
- Integrate or multiply power density over the specified receiving surface when appropriate.
- Use Maxwell's equations to test whether proposed field distributions are self-consistent.
- Infer material parameters from propagation constant and intrinsic impedance when those wave quantities are given.

### Source coverage

- Problem 11.2 asks for $v_p$, $\beta$, $\lambda$, $\mathbf{E}_s$, $\mathbf{H}_s$, and $\langle S\rangle$ for a 20 GHz wave.
- Problems 11.6, 11.10, 11.11, and 11.18 require phasor fields, instantaneous fields, and average power in lossy media.
- Problem 11.8 uses outward power through a spherical shell to determine the radial dependence required for an isotropic radiator.
- Problem 11.9 uses Maxwell's equations to find the magnetic field and the required relation between $\alpha$ and $\beta$ for an evanescent wave.
- Problem 11.13 asks for $\mu$, $\epsilon'$, and $\epsilon''$ from given $jk$ and $\eta$.
- Problem 11.20 estimates focused lightwave power from the air-breakdown field strength.
