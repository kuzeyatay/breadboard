---
title: "Radiation Intensity and Solid Angle"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "radiation-intensity-and-solid-angle"
locations: ["Page 534", "Page 535", "Page 536", "Section 14.2.2", "Section 14.2.3", "Figure 14.4", "Problem D14.2"]
related: ["radiated-power-and-radiation-resistance", "hertzian-dipole-radiation-pattern", "directivity-and-beamwidth", "antenna-gain-and-radiation-efficiency"]
---

## ConceptNode: Radiation Intensity and Solid Angle

Planning node for [[radiation-intensity-and-solid-angle|1.312 Radiation Intensity and Solid Angle]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 534, Page 535, Page 536, Section 14.2.2, Section 14.2.3, Figure 14.4, Problem D14.2

Solid angle provides the angular measure needed to describe how an antenna distributes power over direction. A cone subtending area $A=r^2$ on a sphere of radius $r$ has a solid angle of one steradian. Since the sphere has area $4\pi r^2$, the full sphere contains $4\pi$ steradians. In spherical coordinates, the differential surface area is $dA=r^2\sin\theta\,d\theta\,d\phi$, so the corresponding differential solid angle is $d\Omega=\sin\theta\,d\theta\,d\phi$. Radiation intensity converts radial power density in watts per square meter into power per steradian by multiplying by $r^2$. Thus $K(\theta,\phi)=r^2S_r$. In the far zone, where $S_r$ has the required $1/r^2$ dependence, $K$ is independent of radius and isolates the antenna's directional power distribution. Total radiated power is recovered by integrating $K$ over all solid angles. For the Hertzian dipole, radiation intensity is independent of $\phi$ and varies as $\sin^2\theta$, matching the squared field pattern.

### Key planning details

- Solid angle measures the directional extent of a cone.
- One steradian subtends area $r^2$ on a sphere of radius $r$.
- A complete sphere contains $4\pi$ steradians.
- The differential relation is $dA=r^2d\Omega$.
- In spherical coordinates, $d\Omega=\sin\theta\,d\theta\,d\phi$.
- Radiation intensity is $K=r^2S_r$ in watts per steradian.
- Far-zone radiation intensity is independent of radius.
- Total radiated power is the integral of $K$ over $4\pi$ steradians.

### Source coverage

- The source defines $$dA=r^2d\Omega.$$
- It identifies $$d\Omega=\sin\theta\,d\theta\,d\phi.$$
- Figure 14.4 shows a differential cone subtending differential area on a sphere.
- Radiation intensity is $$K(\theta,\phi)=r^2S_r\ \mathrm{W/sr}.$$
- For the Hertzian dipole, $$K(\theta)=\frac{1}{2}\left(\frac{I_0kd}{4\pi}\right)^2\eta\sin^2\theta.$$
- Total power is $$P_r=\int_0^{2\pi}\int_0^\pi K(\theta,\phi)\sin\theta\,d\theta\,d\phi.$$
- Problem D14.2 gives cone-angle and solid-angle conversion exercises.
