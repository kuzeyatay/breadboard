---
title: "Waveguide Power Flow and Field Structure"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "waveguide-power-flow-and-field-structure"
locations: ["Page 524", "Problems 13.22-13.23"]
related: ["guided-mode-cutoff-and-single-mode-operation", "waveguide-dispersion-and-pulse-broadening", "radiated-power-and-radiation-resistance"]
---

## ConceptNode: Waveguide Power Flow and Field Structure

Planning node for [[waveguide-power-flow-and-field-structure|1.303 Waveguide Power Flow and Field Structure]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 524, Problems 13.22-13.23

The rectangular-waveguide problems connect field expressions to geometric field structure and transported power. For the $\mathrm{TE}_{11}$ mode, transverse field components can be combined into a differential equation for field streamlines. Integration yields a family of curves identified by a constant $C$, showing how modal field geometry can be reconstructed from component equations rather than only plotted numerically. For the dominant $\mathrm{TE}_{10}$ mode, average power density follows from the phasor Poynting vector $\langle\mathbf{S}\rangle=\tfrac{1}{2}\operatorname{Re}\{\mathbf{E}_s\times\mathbf{H}_s^*\}$. The result varies across the guide as $\sin^2(\kappa_{10}x)$ and points along the guide axis. Integrating this density over the cross section produces total average transmitted power. The alternative form involving intrinsic impedance $\eta$ and modal wave angle $\theta_{10}$ ties guided power to the oblique-plane-wave interpretation of waveguide modes. These tasks teach two reusable methods: deriving field-line geometry from ratios of vector components, and obtaining net modal power by integrating the longitudinal Poynting-vector component over the guide aperture.

### Key planning details

- Field streamlines follow from the local ratio of transverse field components.
- The $\mathrm{TE}_{11}$ streamline family is labeled by an integration constant $C$.
- Average power density is obtained from the real part of the phasor Poynting vector.
- For $\mathrm{TE}_{10}$, the power density varies as $\sin^2(\kappa_{10}x)$.
- The power flow is directed along the guide axis.
- Total transmitted power is the cross-sectional integral of average power density.
- The modal wave angle provides an alternative physical interpretation of the power expression.

### Source coverage

- Problem 13.22 gives the streamline equation $$y=\frac{b}{\pi}\cos^{-1}\left[\frac{C}{\cos(\pi x/a)}\right],\qquad 0<x<a,\ 0<y<b.$$
- Problem 13.23 gives $$\langle\mathbf{S}\rangle=\frac{\beta_{10}}{2\omega\mu}E_0^2\sin^2(\kappa_{10}x)\mathbf{a}_z\ \mathrm{W/m^2}.$$
- Cross-sectional integration yields $$P_{av}=\frac{\beta_{10}ab}{4\omega\mu}E_0^2.$$
- The equivalent power form is $$P_{av}=\frac{ab}{4\eta}E_0^2\sin\theta_{10}\ \mathrm{W},$$ with $\eta=\sqrt{\mu/\epsilon}$.
