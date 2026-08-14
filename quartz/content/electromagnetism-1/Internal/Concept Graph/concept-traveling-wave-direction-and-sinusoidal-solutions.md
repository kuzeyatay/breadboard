---
title: "Traveling-Wave Direction and Sinusoidal Solutions"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "traveling-wave-direction-and-sinusoidal-solutions"
locations: ["Page 383", "Page 384", "Page 385"]
related: ["free-space-electromagnetic-wave-equation", "phasor-representation-of-uniform-plane-waves", "lossy-dielectric-propagation-and-complex-wavenumber"]
---

## ConceptNode: Traveling-Wave Direction and Sinusoidal Solutions

Planning node for [[traveling-wave-direction-and-sinusoidal-solutions|1.215 Traveling-Wave Direction and Sinusoidal Solutions]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 383, Page 384, Page 385

The one-dimensional free-space wave equation admits arbitrary forward- and backward-traveling functions, $f_1(t-z/v)$ and $f_2(t+z/v)$. For sinusoidal steady-state fields, these become cosine waves whose signs in the spatial phase term reveal their directions. A phase of $\omega t-k_0z$ moves toward increasing $z$, while $\omega t+k_0z$ moves toward decreasing $z$. This can be proven by holding the phase of a selected crest constant: as time increases, $z$ must increase for the negative spatial sign and decrease for the positive spatial sign. In free space the phase velocity is $c$, and the wavenumber is $k_0=\omega/c$ in radians per meter. Wavenumber is the spatial analogue of angular frequency, measuring phase shift per unit distance. The wavelength is the distance that produces a $2\pi$ phase change, so $\lambda=2\pi/k_0$. These relationships provide the foundation for interpreting both real instantaneous fields and their phasor representations.

### Key planning details

- The general solution is $E_x(z,t)=f_1(t-z/v)+f_2(t+z/v)$.
- The phase $\omega t-k_0z$ represents propagation in the positive $z$ direction.
- The phase $\omega t+k_0z$ represents propagation in the negative $z$ direction.
- In free space, phase velocity is $v_p=c$.
- The free-space wavenumber is $k_0=\omega/c$ in rad/m.
- Wavelength satisfies $k_0\lambda=2\pi$ and $\lambda=2\pi/k_0$.
- Holding a crest's phase constant provides a direct propagation-direction test.

### Source coverage

- Equation (14) gives $E_x(z,t)=f_1(t-z/v)+f_2(t+z/v)$.
- Equation (15) gives forward and backward cosine terms with phases $\omega t-k_0z+\phi_1$ and $\omega t+k_0z+\phi_2$.
- Equation (16) defines $k_0\equiv\omega/c$ rad/m.
- Equation (17) derives $\lambda=2\pi/k_0$ from a $2\pi$ spatial phase change.
- Equation (18) tracks a forward crest through $\omega(t-z/c)=2m\pi$.
