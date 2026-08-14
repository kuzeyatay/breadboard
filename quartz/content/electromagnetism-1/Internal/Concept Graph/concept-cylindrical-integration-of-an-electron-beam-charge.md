---
title: "Cylindrical Integration of an Electron-Beam Charge"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "cylindrical-integration-of-an-electron-beam-charge"
locations: ["Page 46", "Page 47", "Section: Volume Integral Example"]
related: ["volume-charge-density-and-total-enclosed-charge", "electric-field-integral-for-a-volume-charge-distribution", "multipoles-finite-charge-distributions-and-far-field-limits"]
---

## ConceptNode: Cylindrical Integration of an Electron-Beam Charge

Planning node for [[cylindrical-integration-of-an-electron-beam-charge|1.39 Cylindrical Integration of an Electron-Beam Charge]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 46, Page 47, Section: Volume Integral Example

The electron-beam example demonstrates how to convert a spatial charge density into total charge by selecting limits and a differential volume suited to the geometry. The beam occupies a cylindrical region with $0\leq\rho\leq0.01\,\mathrm{m}$, $0\leq\phi\leq2\pi$, and $0.02\leq z\leq0.04\,\mathrm{m}$. In cylindrical coordinates, $dv=\rho\,d\rho\,d\phi\,dz$, so the Jacobian factor $\rho$ must appear in the integrand. The chosen integration order begins with $\phi$, which immediately contributes a factor of $2\pi$. Integrating next with respect to $z$ simplifies the final radial integral because the exponential contains the product $\rho z$. The negative density indicates electron charge, so the enclosed charge is negative. This example provides a reusable workflow: identify the charged region, write the correct coordinate differential, choose an efficient order, apply all bounds, and verify the sign and units.

### Key planning details

- The beam is modeled with an exponentially varying cylindrical charge density.
- The cylindrical volume element is $dv=\rho\,d\rho\,d\phi\,dz$.
- The limits describe a $2\,\mathrm{cm}$ beam segment and a radius of $1\,\mathrm{cm}$.
- Integrating over $\phi$ first exploits full rotational symmetry.
- Integrating over $z$ before $\rho$ simplifies the exponential dependence.
- The negative density produces a negative total electron-beam charge.

### Source coverage

- The density is given as $\rho_v=-5\times10^{-6}e^{-10^5\rho z}$.
- The integral is $$Q=\int_{0.02}^{0.04}\int_0^{2\pi}\int_0^{0.01}-5\times10^{-6}e^{-10^5\rho z}\rho\,d\rho\,d\phi\,dz.$$
- After the $\phi$ integration, the coefficient becomes $-10^{-5}\pi$.
- The remaining radial exponentials are $e^{-2000\rho}$ and $e^{-4000\rho}$.
- The evaluated magnitude is $0.0785\,\mathrm{pC}$, with negative sign implied by the electron density and preceding derivation.
- Source figure S1.P46.F1, Figure 2.5, shows the right circular cylinder over which $Q=\int_{\mathrm{vol}}\rho_vdv$ is evaluated.
