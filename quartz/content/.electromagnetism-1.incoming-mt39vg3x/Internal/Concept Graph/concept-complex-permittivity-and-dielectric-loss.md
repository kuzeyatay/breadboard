---
title: "Complex Permittivity and Dielectric Loss"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "complex-permittivity-and-dielectric-loss"
locations: ["Page 390", "Page 391"]
related: ["lossy-dielectric-propagation-and-complex-wavenumber", "phase-velocity-and-wavelength-in-lossy-media", "distributed-line-parameters-attenuation-and-power-budgets"]
---

## ConceptNode: Complex Permittivity and Dielectric Loss

Planning node for [[complex-permittivity-and-dielectric-loss|1.220 Complex Permittivity and Dielectric Loss]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 390, Page 391

Material loss is modeled by a complex permittivity $\epsilon=\epsilon'-j\epsilon''$. The real part controls energy storage and ordinary phase propagation, while the imaginary part produces a complex wavenumber and attenuation. The source identifies bound-electron or ion oscillations, dipole relaxation, and free-carrier conduction as mechanisms that can contribute to dielectric loss. Magnetic loss can similarly be represented by a complex permeability, but the treatment assumes real $\mu$ because magnetic response is weak in most materials considered. Substituting complex permittivity into $k=\omega\sqrt{\mu\epsilon}$ isolates the dimensionless ratio $\epsilon''/\epsilon'$, called the loss tangent. Taking the real and imaginary parts of $jk$ gives exact expressions for the attenuation coefficient $\alpha$ and phase constant $\beta$. Thus dielectric loss affects both amplitude and phase, changing attenuation, wavelength, and phase velocity. The ratio's size relative to unity is practically important because it determines whether later approximations can simplify the exact expressions.

### Key planning details

- Complex permittivity is $\epsilon=\epsilon'-j\epsilon''=\epsilon_0(\epsilon_r'-j\epsilon_r'')$.
- A nonzero $\epsilon''$ makes the wavenumber complex and produces attenuation.
- The ratio $\epsilon''/\epsilon'$ is the dielectric loss tangent.
- Dielectric loss mechanisms include bound-charge oscillation, dipole relaxation, and free-carrier conduction.
- Complex permeability can model magnetic loss in materials such as ferrites.
- The treatment assumes $\mu$ is real because magnetic loss is usually weaker than dielectric loss.
- Loss changes both $\alpha$ and $\beta$, so it affects amplitude, wavelength, and phase velocity.
- The exact formulas can later be simplified according to the magnitude of the loss tangent.

### Source coverage

- Equation (42) defines $\epsilon=\epsilon'-j\epsilon''=\epsilon_0(\epsilon_r'-j\epsilon_r'')$.
- The source names bound electron or ion oscillations, dipole relaxation, and conduction by free electrons or holes as loss mechanisms.
- Magnetic loss is modeled by $\mu=\mu'-j\mu''=\mu_0(\mu_r'-j\mu_r'')$, with ferrimagnetic materials given as an example.
- Equation (43) gives $k=\omega\sqrt{\mu\epsilon'}\sqrt{1-j\epsilon''/\epsilon'}$.
- Equation (44) gives $\alpha=\omega\sqrt{\mu\epsilon'/2}\left(\sqrt{1+(\epsilon''/\epsilon')^2}-1\right)^{1/2}$.
- Equation (45) gives $\beta=\omega\sqrt{\mu\epsilon'/2}\left(\sqrt{1+(\epsilon''/\epsilon')^2}+1\right)^{1/2}$.
- The source explicitly identifies $\epsilon''/\epsilon'$ as the loss tangent.
