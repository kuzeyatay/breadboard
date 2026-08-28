---
title: "Refractive Index and Material Wave Parameters"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "refractive-index-material-wave-parameters"
locations: ["Page 436", "Section 12.3.3: Special Cases: Half-Wave and Quarter-Wave Layers"]
related: ["half-wave-matching", "fabry-perot-resonance-free-spectral-range", "quarter-wave-matching-antireflection-coatings", "wavevector-representation-general-plane-waves", "phase-matching-reflection-law-snells-law"]
---

## ConceptNode: Refractive Index and Material Wave Parameters

Planning node for [[refractive-index-material-wave-parameters|1.255 Refractive Index and Material Wave Parameters]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 436, Section 12.3.3: Special Cases: Half-Wave and Quarter-Wave Layers

For a lossless, nonmagnetic dielectric, the refractive index provides a compact way to express the medium's electromagnetic wave properties. It is defined by $n=\sqrt{\epsilon_r}$. This notation is especially common at optical frequencies, while relative permittivity is more traditionally quoted at lower frequencies. The source restricts the index formulas to media with no dielectric loss and with $\mu_r=1$, because a lossy medium would generally have a complex relative permittivity and therefore a complex refractive index. Substituting $n$ into the plane-wave relations gives the phase constant $\beta=k=n\omega/c$ and the intrinsic impedance $\eta=\eta_0/n$. Increasing index therefore increases phase accumulation per unit distance while reducing intrinsic impedance. It also reduces phase velocity to $v_p=c/n$ and shortens wavelength to $\lambda=\lambda_0/n$. These linked formulas are central to the later matching, refraction, Fabry-Perot, and dispersion calculations. The notation $n$ must not be confused with the Greek symbol $\eta$, since one is dimensionless refractive index and the other is impedance measured in ohms.

### Key planning details

- The lossless-dielectric refractive index is $n=\sqrt{\epsilon_r}$.
- The phase constant is $\beta=k=n\omega/c$.
- The intrinsic impedance is $\eta=\eta_0/n$.
- The phase velocity is $v_p=c/n$.
- The material wavelength is $\lambda=\lambda_0/n$.
- The stated formulas assume a lossless medium with $\mu_r=1$.
- Refractive index $n$ and intrinsic impedance $\eta$ represent different physical quantities.

### Source coverage

- Equation (38) defines $n=\sqrt{\epsilon_r}$.
- Equation (39) gives $$\beta=k=\omega\sqrt{\mu_0\epsilon_0}\sqrt{\epsilon_r}=\frac{n\omega}{c}.$$
- Equation (40) gives $$\eta=\frac{\eta_0}{n}.$$
- Equation (41) gives $v_p=c/n$.
- Equation (42) gives $\lambda=\lambda_0/n$.
- Page 436 explicitly warns against confusing $n$ with $\eta$.
