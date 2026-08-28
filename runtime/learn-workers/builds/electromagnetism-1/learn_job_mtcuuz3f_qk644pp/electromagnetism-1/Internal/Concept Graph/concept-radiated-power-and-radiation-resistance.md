---
title: "Radiated Power and Radiation Resistance"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "radiated-power-and-radiation-resistance"
locations: ["Page 533", "Page 534", "Section 14.2.1"]
related: ["near-field-and-far-field-behavior", "radiation-intensity-and-solid-angle", "directivity-and-beamwidth", "antenna-gain-and-radiation-efficiency"]
---

## ConceptNode: Radiated Power and Radiation Resistance

Planning node for [[radiated-power-and-radiation-resistance|1.311 Radiated Power and Radiation Resistance]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 533, Page 534, Section 14.2.1

Radiated power is obtained by forming the time-average Poynting vector from the transverse far-zone fields and integrating its radial component over a sphere. Because $E_{\theta s}$ and $H_{\phi s}$ are in phase in the far zone and related by the medium impedance, the radial power density is proportional to $I_0^2k^2d^2\eta\sin^2\theta/r^2$. Multiplication by the spherical area element $r^2\sin\theta\,d\theta\,d\phi$ cancels the radial dependence, so the same net power crosses any sufficiently large sphere in a nonabsorbing medium. In free space, substituting $k=2\pi/\lambda$ and $\eta_0\doteq120\pi$ gives the total average radiated power. Radiation resistance is then defined as the resistance that would dissipate the same average power under sinusoidal current amplitude $I_0$. It is not an ohmic heating resistance, but an input-power representation of radiation. For an electrically tiny element, $R_{\mathrm{rad}}$ scales as $(d/\lambda)^2$ and is very small. This makes efficient radiation and source matching difficult because practical ohmic resistance may be comparable to the radiation resistance while the short antenna's input reactance remains large.

### Key planning details

- Radiated power follows from the radial time-average Poynting vector.
- Far-zone power density varies as $1/r^2$ and $\sin^2\theta$.
- Integration over a spherical surface removes dependence on observation radius.
- Free-space radiated power scales as $(I_0d/\lambda)^2$.
- Radiation resistance equates radiated power to resistive power for the same current amplitude.
- Radiation resistance scales as $(d/\lambda)^2$.
- A very short antenna has small radiation resistance.
- Small radiation resistance worsens efficiency and impedance matching when ohmic loss and reactance are significant.

### Source coverage

- The time-average Poynting vector is $$\langle\mathbf{S}\rangle=\frac{1}{2}\operatorname{Re}\{E_{\theta s}H_{\phi s}^*\}\mathbf{a}_r.$$
- Its magnitude is $$S_r=\frac{1}{2}\left(\frac{I_0kd}{4\pi r}\right)^2\eta\sin^2\theta.$$
- In free space, $$P_r=40\pi^2\left(\frac{I_0d}{\lambda}\right)^2\ \mathrm{W}.$$
- Radiation resistance is defined through $$P_r=\frac{1}{2}I_0^2R_{\mathrm{rad}}.$$
- For the differential antenna, $$R_{\mathrm{rad}}=80\pi^2\left(\frac{d}{\lambda}\right)^2.$$
- For $d=0.01\lambda$, the source gives $R_{\mathrm{rad}}\approx0.08\,\Omega$.
