---
title: "1.220 Complex Permittivity and Dielectric Loss"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 390", "Page 391"]
related: ["lossy-dielectric-propagation-and-complex-wavenumber", "phase-velocity-and-wavelength-in-lossy-media", "distributed-line-parameters-attenuation-and-power-budgets"]
---

# 1.220 Complex Permittivity and Dielectric Loss

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 390, Page 391

Material loss is modeled by a complex permittivity $\epsilon=\epsilon'-j\epsilon''$. The real part controls energy storage and ordinary phase propagation, while the imaginary part produces a complex wavenumber and attenuation. The source identifies bound-electron or ion oscillations, dipole relaxation, and free-carrier conduction as mechanisms that can contribute to dielectric loss. Magnetic loss can similarly be represented by a complex permeability, but the treatment assumes real $\mu$ because magnetic response is weak in most materials considered. Substituting complex permittivity into $k=\omega\sqrt{\mu\epsilon}$ isolates the dimensionless ratio $\epsilon''/\epsilon'$, called the loss tangent. Taking the real and imaginary parts of $jk$ gives exact expressions for the attenuation coefficient $\alpha$ and phase constant $\beta$. Thus dielectric loss affects both amplitude and phase, changing attenuation, wavelength, and phase velocity. The ratio's size relative to unity is practically important because it determines whether later approximations can simplify the exact expressions.

## Page-Grounded Details

#### Page 390

#### 11.2.1 Propagation in Lossy Media

The Helmholtz equation in a homogeneous and isotropic medium is
$$
\nabla^{2}E_{s}=-k^{2}E_{s}\qquad(36)
$$
where the wavenumber is a function of the material properties, as described by $\mu$ and $\epsilon$:
$$
k=\omega\sqrt{\mu\epsilon}=k_{0}\sqrt{\mu_{r}\epsilon_{r}}\qquad(37)
$$
For $E_{xs}$ we have
$$
\frac{d^{2}E_{xs}}{dz^{2}}=-k^{2}E_{xs}\qquad(38)
$$
An important feature of wave propagation in a dielectric is that k can be complex-valued, and as such it is referred to as the complex propagation constant. k becomes complex when loss or gain mechanisms are present in the medium, as will be explained. A general solution of (38), in fact, allows the possibility of a complex k, and it is customary to write it in terms of its real and imaginary parts in the following way:
$$
jk=\alpha+j\beta\qquad(39)
$$
A solution to (38) will be:
$$
E_{xs}=E_{x0}e^{-jkz}=E_{x0}e^{-\alpha z}e^{-j\beta z}\qquad(40)
$$
Multiplying (40) by $e^{j\omega t}$ and taking the real part yields a form of the field that can be more easily visualized:
$$
E_{x}=E_{x0}e^{-\alpha z}\cos(\omega t-\beta z)\qquad(41)
$$
We recognize this as a uniform plan

[Truncated for analysis]

#### Page 391

Two important mechanisms that give rise to a complex permittivity (and thus result in wave losses) are bound electron or ion oscillations and dipole relaxation, both of which are discussed in Appendix E. An additional mechanism is the conduction of free electrons or holes, which we will explore at length in the next section.

Losses arising from the response of the medium to the magnetic field can occur as well, and these are modeled through a complex permeability, $\mu=\mu^{\prime}-j\mu^{\prime\prime}=\mu_{0}$ ($\mu_{r}^{\prime}-j\mu_{r}^{\prime\prime}$). Examples of such media include ferrimagnetic materials, or ferrites. The magnetic response is usually very weak compared to the dielectric response in most materials of interest for wave propagation; in such materials $\mu\approx\mu_{0}$. Consequently, our discussion of loss mechanisms will be confined to those described through the complex permittivity, and we will assume that $\mu$ is entirely real in our treatment.

We can substitute (42) into (37), which results in
$$ k=\omega\sqrt{\mu(\epsilon^{\prime}-j\epsilon^{\prime\prime})}=\omega\sqrt{\mu\epsilon^{\prime}}\sqrt{1-j\frac{\epsilon^{\prime\prime}}{\epsilon^{\prim

[Truncated for analysis]

## Core Ideas

- Complex permittivity is $\epsilon=\epsilon'-j\epsilon''=\epsilon_0(\epsilon_r'-j\epsilon_r'')$.
- A nonzero $\epsilon''$ makes the wavenumber complex and produces attenuation.
- The ratio $\epsilon''/\epsilon'$ is the dielectric loss tangent.
- Dielectric loss mechanisms include bound-charge oscillation, dipole relaxation, and free-carrier conduction.
- Complex permeability can model magnetic loss in materials such as ferrites.
- The treatment assumes $\mu$ is real because magnetic loss is usually weaker than dielectric loss.
- Loss changes both $\alpha$ and $\beta$, so it affects amplitude, wavelength, and phase velocity.
- The exact formulas can later be simplified according to the magnitude of the loss tangent.

## Source Anchors

- Equation (42) defines $\epsilon=\epsilon'-j\epsilon''=\epsilon_0(\epsilon_r'-j\epsilon_r'')$.
- The source names bound electron or ion oscillations, dipole relaxation, and conduction by free electrons or holes as loss mechanisms.
- Magnetic loss is modeled by $\mu=\mu'-j\mu''=\mu_0(\mu_r'-j\mu_r'')$, with ferrimagnetic materials given as an example.
- Equation (43) gives $k=\omega\sqrt{\mu\epsilon'}\sqrt{1-j\epsilon''/\epsilon'}$.
- Equation (44) gives $\alpha=\omega\sqrt{\mu\epsilon'/2}\left(\sqrt{1+(\epsilon''/\epsilon')^2}-1\right)^{1/2}$.
- Equation (45) gives $\beta=\omega\sqrt{\mu\epsilon'/2}\left(\sqrt{1+(\epsilon''/\epsilon')^2}+1\right)^{1/2}$.
- The source explicitly identifies $\epsilon''/\epsilon'$ as the loss tangent.

## Related Pages

- [[lossy-dielectric-propagation-and-complex-wavenumber|Lossy Dielectric Propagation and Complex Wavenumber]]
- [[phase-velocity-and-wavelength-in-lossy-media|Phase Velocity and Wavelength in Lossy Media]]
- [[distributed-line-parameters-attenuation-and-power-budgets|Distributed Line Parameters, Attenuation, and Power Budgets]]

## Concept Dependencies

- causes: [[lossy-dielectric-propagation-and-complex-wavenumber|Lossy Dielectric Propagation and Complex Wavenumber]]
- affects: [[phase-velocity-and-wavelength-in-lossy-media|Phase Velocity and Wavelength in Lossy Media]]
- related: [[distributed-line-parameters-attenuation-and-power-budgets|Distributed Line Parameters, Attenuation, and Power Budgets]]
