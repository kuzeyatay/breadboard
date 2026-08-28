---
title: "Rectangular Waveguide Cutoff and Propagation"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "rectangular-waveguide-cutoff-and-propagation"
locations: ["Page 501, Eqs. (101)-(103)"]
related: ["te-m0-modes-and-the-dominant-te-10-mode", "te-0p-modes-and-rectangular-guide-single-mode-design", "why-rectangular-waveguides-are-needed"]
---

## ConceptNode: Rectangular Waveguide Cutoff and Propagation

Planning node for [[rectangular-waveguide-cutoff-and-propagation|1.285 Rectangular Waveguide Cutoff and Propagation]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 501, Eqs. (101)-(103)

The transverse dimensions a and b, together with the relative permittivity and permeability of the filling material, determine which rectangular-waveguide modes can propagate. For the common case $\mu_r=1$, the refractive index is $n=\sqrt{\epsilon_r}$ and the wave speed in the material is $c/n$. A TE or TM mode indexed by m and p has a cutoff angular frequency set by the quadrature sum of its transverse spatial frequencies. The corresponding cutoff wavelength $\lambda_{Cmp}$ is stated as a free-space wavelength. If the wavelength is measured inside the filling medium, the free-space cutoff value must be divided by n. The longitudinal phase constant $\beta_{mp}$ becomes real only when the operating free-space wavelength $\lambda$ is less than the mode's cutoff wavelength. This gives a direct propagation test: $\lambda<\lambda_{Cmp}$. As the operating frequency rises, more indexed modes satisfy this inequality, so the guide dimensions and material properties determine both the first propagating mode and the number of simultaneously propagating modes.

### Key planning details

- For $\mu_r=1$, use $n=\sqrt{\epsilon_r}$ and material wave speed $c/n$.
- The cutoff frequency depends on both transverse indices m and p and on dimensions a and b.
- The stated $\lambda_{Cmp}$ is the free-space wavelength at cutoff.
- The cutoff wavelength measured in the filling medium is $\lambda_{Cmp}/n$.
- A TE_mp or TM_mp mode propagates when $\lambda<\lambda_{Cmp}$.
- The phase constant is real above cutoff and loses its propagating character below cutoff.

### Source coverage

- Equation (101): $$\omega_{Cmp}=\frac{c}{n}\left[\left(\frac{m\pi}{a}\right)^2+\left(\frac{p\pi}{b}\right)^2\right]^{1/2}.$$
- Equation (102): $$\lambda_{Cmp}=2n\left[\left(\frac{m}{a}\right)^2+\left(\frac{p}{b}\right)^2\right]^{-1/2}.$$
- Equation (103): $$\beta_{mp}=\frac{2\pi n}{\lambda}\sqrt{1-\left(\frac{\lambda}{\lambda_{Cmp}}\right)^2}.$$
- The source explicitly states that $\lambda_{Cmp}$ is a free-space wavelength and that the in-medium cutoff wavelength is smaller by a factor n.
- The source states that TE_mp and TM_mp propagation requires the operating wavelength to be less than the cutoff wavelength.
