---
title: "Directivity and Beamwidth"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "directivity-and-beamwidth"
locations: ["Page 536", "Page 537", "Page 538", "Section 14.2.4", "Problem D14.3"]
related: ["radiation-intensity-and-solid-angle", "hertzian-dipole-radiation-pattern", "antenna-gain-and-radiation-efficiency", "thin-wire-dipole-current-distribution"]
---

## ConceptNode: Directivity and Beamwidth

Planning node for [[directivity-and-beamwidth|1.313 Directivity and Beamwidth]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 536, Page 537, Page 538, Section 14.2.4, Problem D14.3

Directivity compares an antenna's radiation intensity in a selected direction with the intensity that an isotropic radiator would produce using the same total radiated power. An isotropic source has constant intensity $K_{\mathrm{iso}}=P_r/(4\pi)$. Therefore the directivity function is $D(\theta,\phi)=4\pi K(\theta,\phi)/P_r$, and maximum directivity uses the largest radiation intensity. Directivity is dimensionless but is commonly expressed in decibels using $10\log_{10}D_{\max}$. Applying the definition to the Hertzian dipole gives $D(\theta,\phi)=\tfrac{3}{2}\sin^2\theta$, so the maximum value is $3/2$ at $\theta=90^\circ$, or $1.76\,\mathrm{dB}$. This modest value reflects the dipole's broad E-plane radiation. The 3 dB beamwidth measures the angular separation between points where directivity falls to half its peak value. For the Hertzian dipole, $\sin^2\theta=1/2$ at $45^\circ$ and $135^\circ$, yielding a $90^\circ$ beamwidth. The source notes that longer antennas narrow the E-plane beam and increase radiation resistance, while narrowing the azimuthally uniform H-plane pattern requires multiple antennas in an array.

### Key planning details

- An isotropic radiator has $K_{\mathrm{iso}}=P_r/(4\pi)$.
- Directivity compares actual directional intensity with isotropic intensity for equal radiated power.
- Maximum directivity is based on $K_{\max}$.
- Directivity in decibels is $10\log_{10}D_{\max}$.
- The Hertzian dipole has $D(\theta,\phi)=\tfrac{3}{2}\sin^2\theta$.
- Its maximum directivity is $1.5$, or $1.76\,\mathrm{dB}$.
- Its 3 dB E-plane beamwidth is $90^\circ$.
- An antenna array is needed to narrow the H-plane pattern.

### Source coverage

- The isotropic intensity is $$K_{\mathrm{iso}}=\frac{P_r}{4\pi}.$$
- The directivity function is $$D(\theta,\phi)=\frac{4\pi K(\theta,\phi)}{\oint K\,d\Omega}.$$
- Maximum directivity is $$D_{\max}=\frac{4\pi K_{\max}}{\oint K\,d\Omega}.$$
- The decibel definition is $$D_{\mathrm{dB}}=10\log_{10}(D_{\max}).$$
- The worked example obtains $$D(\theta,\phi)=\frac{3}{2}\sin^2\theta,$$ $$D_{\max}=\frac{3}{2},$$ and $D_{\mathrm{dB}}=1.76\,\mathrm{dB}$.
- Problem D14.3 gives directivity results for half-space, $\cos^2\theta$, and $|\cos^n\theta|$ power distributions.
- The Hertzian-dipole half-power angles are $45^\circ$ and $135^\circ$.
