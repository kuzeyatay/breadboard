---
title: "1.279 Parallel-Plate TE Magnetic Fields"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 493, Equations (69) and (70)", "Page 494, Equations (71) through (75)"]
related: ["parallel-plate-wave-equation-eigenmodes", "te-and-tm-polarization-in-parallel-plate-guides", "rectangular-waveguide-transverse-field-reconstruction"]
---

# 1.279 Parallel-Plate TE Magnetic Fields

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 493, Equations (69) and (70), Page 494, Equations (71) through (75)

Once the parallel-plate TE electric field is known, Maxwell's curl equation determines its magnetic field. Starting with
$$
\nabla\times\mathbf{E}_s=-j\omega\mu\mathbf{H}_s
$$
 and $E_{ys}=E_0\sin(\kappa_m x)e^{-j\beta_m z}$, the curl produces both axial and transverse magnetic components. The resulting fields are
$$
H_{xs}=-\frac{\beta_m}{\omega\mu}E_0\sin(\kappa_m x)e^{-j\beta_m z}
$$
 and
$$
H_{zs}=j\frac{\kappa_m}{\omega\mu}E_0\cos(\kappa_m x)e^{-j\beta_m z}
$$
 These components form closed-loop patterns in the $x,z$ plane, consistent with the TE designation because the magnetic field has a longitudinal component while the electric field does not. Computing the magnetic magnitude and using $\kappa_m^2+\beta_m^2=k^2$ and $\sin^2u+\cos^2u=1$ yields
$$
|H_s|=\frac{E_0}{\eta}
$$
 where $\eta=\sqrt{\mu/\epsilon}$ is the medium intrinsic impedance. This agrees with the constituent plane-wave interpretation.

## Page-Grounded Details

#### Page 493

Figure 13.17 (a) A plane wave associated with an $m=4$ mode, showing a net phase shift of $4\pi$ (two wavelengths measured in $x$) occurring over distance $d$ in the transverse plane. (b) As frequency increases, an increase in wave angle is required to maintain the $4\pi$ transverse phase shift.

Now, as the frequency increases, wavelength will decrease, and so the requirement of wavelength equaling an integer multiple of $2d$ is no longer met. The response of the mode is to establish $z$ components of $\mathbf{k}_{u}$ and $\mathbf{k}_{d}$, which results in the decreased wavelength being compensated by an increase in wavelength as measured in the $x$ direction. Figure 13.17 shows this effect for the $m=4$ mode, in which the wave angle, $\theta_{4}$, steadily increases with increasing frequency. Thus, the mode retains precisely the functional form of its field in the $x$ direction, but it establishes an increasing value of $\beta_{m}$ as the frequency is raised. This invariance in the transverse spatial pattern means that the mode will retain its identity at all frequencies. Group velocity, expressed in (57), is changing as well, meaning that the changing

[Truncated for analysis]

#### Page 494

We solve for $H_{s}$ by dividing both sides of (69) by $-j\omega\mu$. Performing this operation on (70), we obtain the two magnetic field components:
$$
H_{xs}=-\frac{\beta_{m}}{\omega\mu}E_{0}\sin(\kappa_{m}x)e^{-j\beta_{m}z}
$$
(71)
$$
H_{zs}=j\frac{\kappa_{m}}{\omega\mu}E_{0}\cos(\kappa_{m}x)e^{-j\beta_{m}z}
$$
(72)

Together, these two components form closed-loop patterns for $H_{s}$ in the x, z plane, as can be verified using the streamline plotting methods developed in Section 2.6.

It is interesting to consider the magnitude of $H_{s}$, which is found through
$$
|H_{s}|=\sqrt{H_{s}\cdot H_{s}^{*}}=\sqrt{H_{xs}H_{xs}^{*}+H_{zs}H_{zs}^{*}}
$$
(73)

Carrying this out using (71) and (72) results in
$$
|H_{s}|=\frac{E_{0}}{\omega\mu}(\kappa_{m}^{2}+\beta_{m}^{2})^{1/2}(\sin^{2}(\kappa_{m}x)+\cos^{2}(\kappa_{m}x))^{1/2}
$$
(74)

Using the fact that $\kappa_{m}^{2}+\beta_{m}^{2}=k^{2}$ and using the identity $\sin^{2}(\kappa_{m}x)+\cos^{2}(\kappa_{m}x)=1$, (74) becomes
$$
|H_{s}|=\frac{k}{\omega\mu}E_{0}=\frac{\omega\sqrt{\mu\epsilon}}{\omega\mu}=\frac{E_{0}}{\eta}
$$
(75)

where $\eta=\sqrt{\mu/\epsilon}$. This result is consistent with our understanding of

[Truncated for analysis]

## Core Ideas

- A TE mode has $E_z=0$ but generally has $H_z\ne0$.
- The curl of $E_y$ produces $H_x$ and $H_z$.
- $H_x$ is proportional to $-\beta_m\sin(\kappa_m x)$.
- $H_z$ is proportional to $j\kappa_m\cos(\kappa_m x)$.
- The magnetic field forms closed loops in the $x,z$ plane.
- The identity $\kappa_m^2+\beta_m^2=k^2$ simplifies the field magnitude.
- The final amplitude relation is $|H_s|=E_0/\eta$.

## Source Anchors

- Equation (69) states the Maxwell curl relation used to recover $\mathbf{H}_s$.
- Equation (70) explicitly evaluates the curl of the TE electric field.
- Equations (71) and (72) give $H_{xs}$ and $H_{zs}$.
- Equations (73) through (75) derive $|H_s|=E_0/\eta$.
- The source states that the two magnetic components form closed-loop patterns in the $x,z$ plane.

## Related Pages

- [[parallel-plate-wave-equation-eigenmodes|Parallel-Plate Wave-Equation Eigenmodes]]
- [[te-and-tm-polarization-in-parallel-plate-guides|TE and TM Polarization in Parallel-Plate Guides]]
- [[rectangular-waveguide-transverse-field-reconstruction|Rectangular Waveguide Transverse Field Reconstruction]]

## Concept Dependencies

- related: [[rectangular-waveguide-transverse-field-reconstruction|Rectangular Waveguide Transverse Field Reconstruction]]
