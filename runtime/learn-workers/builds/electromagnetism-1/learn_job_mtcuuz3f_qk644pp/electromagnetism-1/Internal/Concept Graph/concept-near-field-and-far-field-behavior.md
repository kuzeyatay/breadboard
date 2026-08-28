---
title: "Near-Field and Far-Field Behavior"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "near-field-and-far-field-behavior"
locations: ["Page 531", "Page 532", "Page 533", "Section 14.1.2", "Section 14.1.3", "Problem D14.1"]
related: ["general-electromagnetic-fields-of-a-hertzian-dipole", "hertzian-dipole-radiation-pattern", "radiated-power-and-radiation-resistance", "radiation-intensity-and-solid-angle"]
---

## ConceptNode: Near-Field and Far-Field Behavior

Planning node for [[near-field-and-far-field-behavior|1.309 Near-Field and Far-Field Behavior]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 531, Page 532, Page 533, Section 14.1.2, Section 14.1.3, Problem D14.1

The distance dependence of the Hertzian-dipole fields separates reactive energy storage from outward radiation. Close to the element, terms proportional to $1/r^3$ and $1/r^2$ can greatly exceed the $1/r$ term. The $1/r^3$ electric contribution resembles the electrostatic field of a dipole and represents energy stored in a reactive, predominantly capacitive field. The $1/r^2$ magnetic contribution corresponds to the induction field associated with a current element and the Biot-Savart law. These near-field terms do not contribute to the net radiated power. At distances comparable to a wavelength, the different radial terms and their additional phases combine to produce spatial oscillations that are not uniformly periodic. At large distances, $kr\gg1$, equivalently $r\gg\lambda$, the inverse-distance terms dominate and the field approaches a sinusoidal outgoing wave with a well-defined wavelength. The source uses roughly ten wavelengths as a practical far-zone example. In this region $E_{rs}$ is negligible, while $E_{\theta s}$ and $H_{\phi s}$ remain, satisfy $E_{\theta s}=\eta H_{\phi s}$, and locally approximate a uniform plane wave.

### Key planning details

- The $1/r^3$ electric term dominates extremely close to the source.
- The $1/r^3$ term resembles an electrostatic dipole field.
- The $1/r^2$ magnetic term resembles an induction field from the Biot-Savart law.
- Near-field terms store reactive energy and do not produce net radiated power.
- Fields at distances comparable to $\lambda$ have nonuniform spatial periodicity.
- Far-zone conditions are $kr\gg1$ or $r\gg\lambda$.
- Only the $1/r$ radiation fields remain significant in the far zone.
- The far fields satisfy the plane-wave relation $E_{\theta s}=\eta H_{\phi s}$.

### Source coverage

- At $r=1\,\mathrm{cm}$ in the stated numerical comparison, the relative $1/r^3$, $1/r^2$, and $1/r$ contributions to $E_{\theta s}$ are approximately 250, 16, and 1.
- The instantaneous magnetic field example reduces to $$\mathcal{H}_\phi=\frac{1}{r^2}\left[\cos\left(\frac{2\pi r}{\lambda}\right)+\frac{2\pi r}{\lambda}\sin\left(\frac{2\pi r}{\lambda}\right)\right].$$
- The source identifies distances of about ten or more wavelengths as a practical far-zone range.
- The far fields are $$E_{rs}\doteq0,$$ $$E_{\theta s}=j\frac{I_0kd}{4\pi r}\eta\sin\theta\,e^{-jkr},$$ and $$H_{\phi s}=j\frac{I_0kd}{4\pi r}\sin\theta\,e^{-jkr}.$$
- Problem D14.1 compares $|E_{\theta s}|$ from 1 cm through 2 m for a short antenna with $\lambda=10\,\mathrm{cm}$.
