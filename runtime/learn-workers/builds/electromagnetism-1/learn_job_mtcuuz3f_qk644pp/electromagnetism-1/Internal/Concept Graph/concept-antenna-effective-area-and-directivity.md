---
title: "Antenna Effective Area and Directivity"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "antenna-effective-area-and-directivity"
locations: ["Page 563", "Page 568, Problem 14.30"]
related: ["friis-free-space-transmission-formula", "antenna-reciprocity-and-link-reversal", "dipole-radiation-patterns-and-directivity"]
---

## ConceptNode: Antenna Effective Area and Directivity

Planning node for [[antenna-effective-area-and-directivity|1.334 Antenna Effective Area and Directivity]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 563, Page 568, Problem 14.30

The effective area of a receiving antenna measures how much power it can deliver to a matched load from an incident power density. For the Hertzian dipole, the source gives $A_{e2}(\theta_2)=\frac{3}{8\pi}\lambda^2\sin^2\theta_2$ and the previously derived directivity $D_2(\theta_2)=\frac{3}{2}\sin^2\theta_2$. Their identical angular dependence reveals the general relation $$D(\theta,\phi)=\frac{4\pi}{\lambda^2}A_e(\theta,\phi).$$ Thus effective area is not merely a physical aperture size. It is a direction-dependent receiving property directly proportional to transmitting directivity and to the square of wavelength. Solving for area gives $A_e=\lambda^2D/(4\pi)$, so maximum directivity determines maximum effective area. Directivity expressed in decibels must first be converted to a linear ratio before this formula is used. The check problem with $D_{\max}=6$ dB and $\lambda=1$ m gives $D_{\max}\approx4$ and $A_{e,\max}=1/\pi\ \mathrm{m^2}$. This relation also supports reciprocity-based reasoning for antennas used alternately as transmitters and receivers.

### Key planning details

- Effective area is defined through received load power divided by incident power density.
- For a Hertzian dipole, $A_e(\theta)=\frac{3}{8\pi}\lambda^2\sin^2\theta$.
- For a Hertzian dipole, $D(\theta)=\frac{3}{2}\sin^2\theta$.
- For any antenna in the stated framework, $D(\theta,\phi)=\frac{4\pi}{\lambda^2}A_e(\theta,\phi)$.
- The inverse relation is $A_e(\theta,\phi)=\frac{\lambda^2}{4\pi}D(\theta,\phi)$.
- Directivity in decibels must be converted using $D=10^{D_{\mathrm{dB}}/10}$.

### Source coverage

- Equation (102): $A_{e2}(\theta_2)=\frac{3}{8\pi}\lambda^2\sin^2(\theta_2)\ [\mathrm{m^2}]$.
- Equation (103): $D_2(\theta_2)=\frac{3}{2}\sin^2(\theta_2)$.
- Equation (104): $D(\theta,\phi)=\frac{4\pi}{\lambda^2}A_e(\theta,\phi)$.
- D14.10 gives $D_{\max}=6$ dB, $\lambda=1$ m, and the answer $A_{e,\max}=1/\pi\ \mathrm{m^2}$.
- Problem 14.30 asks for half-wave-dipole directivity in terms of $A_{\max}$ and $\lambda$ and asks where the effective area reaches its maximum.
