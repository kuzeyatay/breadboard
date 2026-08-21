---
title: "Lossy Dielectric Propagation and Complex Wavenumber"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "lossy-dielectric-propagation-and-complex-wavenumber"
locations: ["Page 389", "Page 390"]
related: ["vector-helmholtz-equation-in-free-space", "complex-permittivity-and-dielectric-loss", "traveling-wave-direction-and-sinusoidal-solutions", "phase-velocity-and-wavelength-in-lossy-media"]
---

## ConceptNode: Lossy Dielectric Propagation and Complex Wavenumber

Planning node for [[lossy-dielectric-propagation-and-complex-wavenumber|1.219 Lossy Dielectric Propagation and Complex Wavenumber]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 389, Page 390

The plane-wave analysis extends from free space to a homogeneous, isotropic dielectric with spatially constant permittivity $\epsilon$ and permeability $\mu$. Its Helmholtz equation retains the form $\nabla^2\mathbf{E}_s=-k^2\mathbf{E}_s$, but the material wavenumber is $k=\omega\sqrt{\mu\epsilon}=k_0\sqrt{\mu_r\epsilon_r}$. When loss or gain is present, $k$ may be complex. Writing $jk=\alpha+j\beta$ separates amplitude change from phase change. A forward electric-field phasor then becomes $E_{xs}=E_{x0}e^{-\alpha z}e^{-j\beta z}$, and the corresponding instantaneous field is $E_x=E_{x0}e^{-\alpha z}\cos(\omega t-\beta z)$. Positive $\alpha$ describes passive attenuation, while negative $\alpha$ describes gain, such as in a laser amplifier. The attenuation coefficient is measured in nepers per meter. Over a distance $1/\alpha$, a passive wave's amplitude falls by $e^{-1}$ to approximately 0.368 of its initial value.

### Key planning details

- The dielectric Helmholtz equation is $\nabla^2\mathbf{E}_s=-k^2\mathbf{E}_s$.
- The material wavenumber is $k=\omega\sqrt{\mu\epsilon}$.
- Relative material parameters give $k=k_0\sqrt{\mu_r\epsilon_r}$.
- The decomposition $jk=\alpha+j\beta$ separates attenuation and phase.
- The forward phasor is $E_{x0}e^{-\alpha z}e^{-j\beta z}$.
- Positive $\alpha$ represents loss; negative $\alpha$ represents gain.
- Attenuation coefficient has units of Np/m.
- At distance $1/\alpha$, amplitude is reduced to $e^{-1}$.

### Source coverage

- The dielectric is assumed homogeneous and isotropic on Page 389.
- Equations (36) and (37) give $\nabla^2\mathbf{E}_s=-k^2\mathbf{E}_s$ and $k=\omega\sqrt{\mu\epsilon}=k_0\sqrt{\mu_r\epsilon_r}$.
- Equation (39) defines $jk=\alpha+j\beta$.
- Equations (40) and (41) give $E_{xs}=E_{x0}e^{-\alpha z}e^{-j\beta z}$ and $E_x=E_{x0}e^{-\alpha z}\cos(\omega t-\beta z)$.
- The source states that if $\alpha=0.01$ Np/m, the amplitude at $z=50$ m is 0.607 of the value at $z=0$.
- The source identifies negative $\alpha$ with gain and gives laser amplifiers as an example.
