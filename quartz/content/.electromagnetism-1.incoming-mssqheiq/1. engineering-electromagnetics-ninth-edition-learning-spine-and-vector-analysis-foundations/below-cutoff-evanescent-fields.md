---
title: "1.275 Below-Cutoff Evanescent Fields"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 488, Equations (50) through (52)"]
related: ["parallel-plate-mode-propagation-and-cutoff", "te-mode-fields-from-plane-wave-superposition", "phase-and-group-velocities-in-a-waveguide"]
---

# 1.275 Below-Cutoff Evanescent Fields

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 488, Equations (50) through (52)

When the operating frequency falls below a mode's cutoff, the axial phase constant becomes imaginary rather than real. Writing $\beta_m=-j\alpha_m$ converts the propagation factor $e^{-j\beta_m z}$ into the decaying factor $e^{-\alpha_m z}$. The TE field then has the form
$$
E_{ys}=E_0'\sin(\kappa_m x)e^{-\alpha_m z}
$$
 or instantaneously,
$$
E_y(x,z,t)=E_0'\sin(\kappa_m x)e^{-\alpha_m z}\cos(\omega t)
$$
 This field oscillates in time but does not carry a phase pattern progressively down the guide. Its amplitude decreases exponentially with increasing $z$. The attenuation coefficient is
$$
\alpha_m=\frac{n\omega_{cm}}{c}\sqrt{1-\left(\frac{\omega}{\omega_{cm}}\right)^2}=\frac{2\pi n}{\lambda_{cm}}\sqrt{1-\left(\frac{\lambda_{cm}}{\lambda}\right)^2}
$$
 The result provides the physical meaning of cutoff: below cutoff, the mode can exist locally as an evanescent field but cannot propagate as a guided traveling mode.

## Page-Grounded Details

#### Page 488

#### 13.3.3 Plane Wave Superposition, Phase and Group Velocities

The field configuration for a given mode can be found through the superposition of the fields of all the reflected waves. We can do this for the TE waves, for example, by writ-ing the electric field phasor in the guide in terms of incident and reflected fields through
$$
E_{ys}=E_{0}e^{-j\mathbf{k}_{u}\cdot\mathbf{r}}-E_{0}e^{-j\mathbf{k}_{d}\cdot\mathbf{r}}\quad{(45)}
$$
where the wavevectors, $\mathbf{k}_{u}$ and $\mathbf{k}_{d}$ , are indicated in Figure 13.12. The minus sign in front of the second term arises from the $\pi$ phase shift on reflection. From the geom-etry depicted in Figure 13.14, we write
$$
\mathbf{k}_{u}=\kappa_{m}\mathbf{a}_{x}+\beta_{m}\mathbf{a}_{z}\quad{(46)}
$$
and
$$
\mathbf{k}_{d}=-\kappa_{m}\mathbf{a}_{x}+\beta_{m}\mathbf{a}_{z}\quad{(47)}
$$
Then, using
$$
\mathbf{r}=x\mathbf{a}_{x}+z\mathbf{a}_{z}
$$
Eq. (45) becomes
$$
E_{ys}=E_{0}(e^{-j\kappa_{m}x}-e^{j\kappa_{m}x})e^{-j\beta_{m}z}=2j\,E_{0}\sin(\kappa_{m}x)e^{-j\beta_{m}z}=E_{0}^{\prime}\,\sin(\kappa_{m}x)e^{-j\beta_{m}z}\qquad(48)
$$
where the plane wave amplitude, $E_{0}$ , and the overall phase are absorbed into $ E^{\

[Truncated for analysis]

## Core Ideas

- Below cutoff, $\omega<\omega_{cm}$.
- The axial phase constant is written $\beta_m=-j\alpha_m$.
- The axial field dependence becomes $e^{-\alpha_m z}$.
- The field continues to oscillate at angular frequency $\omega$.
- There is no progressive axial phase term below cutoff.
- $\alpha_m$ quantifies exponential decay per unit axial distance.
- The transverse sine profile remains present below cutoff.

## Source Anchors

- Equations (50) and (51) give the phasor and instantaneous TE fields below cutoff.
- The source states that the mode does not propagate and decreases in strength with increasing $z$.
- Equation (52) gives $\alpha_m$ in frequency and wavelength forms.

## Related Pages

- [[parallel-plate-mode-propagation-and-cutoff|Parallel-Plate Mode Propagation and Cutoff]]
- [[te-mode-fields-from-plane-wave-superposition|TE Mode Fields from Plane-Wave Superposition]]
- [[phase-and-group-velocities-in-a-waveguide|Phase and Group Velocities in a Waveguide]]

## Concept Dependencies

- depends-on: [[parallel-plate-mode-propagation-and-cutoff|Parallel-Plate Mode Propagation and Cutoff]]
