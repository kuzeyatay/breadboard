---
title: "Antenna Gain and Radiation Efficiency"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "antenna-gain-and-radiation-efficiency"
locations: ["Page 538", "Section 14.2.5"]
related: ["directivity-and-beamwidth", "radiated-power-and-radiation-resistance", "radiation-intensity-and-solid-angle"]
---

## ConceptNode: Antenna Gain and Radiation Efficiency

Planning node for [[antenna-gain-and-radiation-efficiency|1.314 Antenna Gain and Radiation Efficiency]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 538, Section 14.2.5

Gain modifies directivity to account for the fact that not all power supplied to an antenna is radiated. If the antenna input power is $P_{in}$ and conductor losses are present, then the radiated power $P_r$ is smaller. The reference for gain is an ideal isotropic antenna that radiates all supplied input power, giving reference intensity $K_s=P_{in}/(4\pi)$. Actual gain in a direction is therefore $G(\theta,\phi)=4\pi K(\theta,\phi)/P_{in}$. Directivity uses the same numerator but divides by radiated power rather than input power, so the ratio between gain and directivity is the radiation efficiency. The source defines $\eta_r=P_r/P_{in}$ and derives $D=G/\eta_r$, equivalently $G=\eta_rD$. The efficiency can be obtained from either directional quantities or their maxima because $G(\theta,\phi)/D(\theta,\phi)$ is independent of direction under the stated definitions. These distinctions prevent a highly directional but lossy antenna from being credited with the same performance as an equally directional efficient antenna.

### Key planning details

- Input power generally exceeds radiated power because of resistive loss.
- The gain reference is an ideal isotropic radiator using all input power.
- Gain is $4\pi K/P_{in}$.
- Directivity is $4\pi K/P_r$.
- Radiation efficiency is $\eta_r=P_r/P_{in}$.
- Gain and directivity satisfy $G=\eta_rD$.
- Efficiency can be found from $G/D$ or $G_{\max}/D_{\max}$.
- Gain includes loss performance, while directivity describes angular concentration of radiated power.

### Source coverage

- The isotropic input-power reference intensity is $K_s=P_{in}/4\pi$.
- Gain is defined as $$G(\theta,\phi)=\frac{4\pi K(\theta,\phi)}{P_{in}}.$$
- The source derives $$D(\theta,φ)=\frac{1}{\eta_r}G(\theta,φ).$$
- Radiation efficiency is $$\eta_r=\frac{P_r}{P_{in}}=\frac{G(\theta,φ)}{D(\theta,φ)}=\frac{G_{\max}}{D_{\max}}.$$
