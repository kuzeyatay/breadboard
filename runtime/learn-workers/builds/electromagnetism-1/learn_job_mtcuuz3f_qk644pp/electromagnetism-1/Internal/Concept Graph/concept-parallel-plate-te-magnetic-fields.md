---
title: "Parallel-Plate TE Magnetic Fields"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "parallel-plate-te-magnetic-fields"
locations: ["Page 493, Equations (69) and (70)", "Page 494, Equations (71) through (75)"]
related: ["parallel-plate-wave-equation-eigenmodes", "te-and-tm-polarization-in-parallel-plate-guides", "rectangular-waveguide-transverse-field-reconstruction"]
---

## ConceptNode: Parallel-Plate TE Magnetic Fields

Planning node for [[parallel-plate-te-magnetic-fields|1.279 Parallel-Plate TE Magnetic Fields]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 493, Equations (69) and (70), Page 494, Equations (71) through (75)

Once the parallel-plate TE electric field is known, Maxwell's curl equation determines its magnetic field. Starting with $$\nabla\times\mathbf{E}_s=-j\omega\mu\mathbf{H}_s$$ and $E_{ys}=E_0\sin(\kappa_m x)e^{-j\beta_m z}$, the curl produces both axial and transverse magnetic components. The resulting fields are $$H_{xs}=-\frac{\beta_m}{\omega\mu}E_0\sin(\kappa_m x)e^{-j\beta_m z}$$ and $$H_{zs}=j\frac{\kappa_m}{\omega\mu}E_0\cos(\kappa_m x)e^{-j\beta_m z}.$$ These components form closed-loop patterns in the $x,z$ plane, consistent with the TE designation because the magnetic field has a longitudinal component while the electric field does not. Computing the magnetic magnitude and using $\kappa_m^2+\beta_m^2=k^2$ and $\sin^2u+\cos^2u=1$ yields $$|H_s|=\frac{E_0}{\eta},$$ where $\eta=\sqrt{\mu/\epsilon}$ is the medium intrinsic impedance. This agrees with the constituent plane-wave interpretation.

### Key planning details

- A TE mode has $E_z=0$ but generally has $H_z\ne0$.
- The curl of $E_y$ produces $H_x$ and $H_z$.
- $H_x$ is proportional to $-\beta_m\sin(\kappa_m x)$.
- $H_z$ is proportional to $j\kappa_m\cos(\kappa_m x)$.
- The magnetic field forms closed loops in the $x,z$ plane.
- The identity $\kappa_m^2+\beta_m^2=k^2$ simplifies the field magnitude.
- The final amplitude relation is $|H_s|=E_0/\eta$.

### Source coverage

- Equation (69) states the Maxwell curl relation used to recover $\mathbf{H}_s$.
- Equation (70) explicitly evaluates the curl of the TE electric field.
- Equations (71) and (72) give $H_{xs}$ and $H_{zs}$.
- Equations (73) through (75) derive $|H_s|=E_0/\eta$.
- The source states that the two magnetic components form closed-loop patterns in the $x,z$ plane.
