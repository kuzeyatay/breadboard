---
title: "1.221 Phase Velocity and Wavelength in Lossy Media"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 390", "Page 391"]
related: ["lossy-dielectric-propagation-and-complex-wavenumber", "complex-permittivity-and-dielectric-loss", "traveling-wave-direction-and-sinusoidal-solutions"]
---

# 1.221 Phase Velocity and Wavelength in Lossy Media

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 390, Page 391

Even when a dielectric attenuates a wave, the phase motion is controlled by the phase constant $\beta$. In the instantaneous field $E_x=E_{x0}e^{-\alpha z}\cos(\omega t-\beta z)$, holding a point of constant phase requires $\omega t-\beta z$ to remain fixed. Differentiating that condition gives the phase velocity $v_p=\omega/\beta$. The wavelength is the distance over which the spatial phase advances by $2\pi$, so $\beta\lambda=2\pi$ and therefore $\lambda=2\pi/\beta$. Because the exact expression for $\beta$ contains both $\epsilon'$ and $\epsilon''$, dielectric loss can alter phase velocity and wavelength as well as amplitude. This distinguishes $\beta$, which measures spatial phase accumulation in radians per meter, from $\alpha$, which measures exponential amplitude reduction in nepers per meter. The two quantities jointly describe propagation through the complex constant $jk=\alpha+j\beta$.

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

- Phase velocity in a lossy medium is $v_p=\omega/\beta$.
- Wavelength satisfies $\beta\lambda=2\pi$.
- Therefore $\lambda=2\pi/\beta$.
- The attenuation coefficient $\alpha$ controls amplitude decay.
- The phase constant $\beta$ controls spatial phase accumulation.
- Complex permittivity can change both attenuation and phase propagation.
- The pair $\alpha$ and $\beta$ fully separates amplitude and phase effects in the propagation factor.

## Source Anchors

- Equation (41) displays the phase as $\omega t-\beta z$ and the attenuation factor as $e^{-\alpha z}$.
- Equation (45) makes $\beta$ depend on $\epsilon''/\epsilon'$ as well as $\mu\epsilon'$.
- Equation (46) gives $v_p=\omega/\beta$.
- Page 391 states that wavelength is the distance required for a $2\pi$ phase change and gives $\beta\lambda=2\pi$.
- The source explicitly notes that $\epsilon''$ affects phase constant, wavelength, and phase velocity.

## Related Pages

- [[lossy-dielectric-propagation-and-complex-wavenumber|Lossy Dielectric Propagation and Complex Wavenumber]]
- [[complex-permittivity-and-dielectric-loss|Complex Permittivity and Dielectric Loss]]
- [[traveling-wave-direction-and-sinusoidal-solutions|Traveling-Wave Direction and Sinusoidal Solutions]]

## Concept Dependencies

- depends-on: [[lossy-dielectric-propagation-and-complex-wavenumber|Lossy Dielectric Propagation and Complex Wavenumber]]
- depends-on: [[complex-permittivity-and-dielectric-loss|Complex Permittivity and Dielectric Loss]]
- related: [[traveling-wave-direction-and-sinusoidal-solutions|Traveling-Wave Direction and Sinusoidal Solutions]]
