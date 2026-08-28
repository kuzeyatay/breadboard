---
title: "1.278 Parallel-Plate Wave-Equation Eigenmodes"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 491, Section 13.4 and Equations (58) through (61)", "Page 492, Equations (62) through (68)", "Page 493, Figure 13.17", "Page 494, Problem D13.9"]
related: ["transverse-resonance-and-mode-quantization", "te-mode-fields-from-plane-wave-superposition", "parallel-plate-te-magnetic-fields"]
---

# 1.278 Parallel-Plate Wave-Equation Eigenmodes

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 491, Section 13.4 and Equations (58) through (61), Page 492, Equations (62) through (68), Page 493, Figure 13.17, Page 494, Problem D13.9

The wave-equation method obtains the same discrete parallel-plate modes without relying on a ray picture. In a lossless dielectric, the phasor field obeys
$$
\nabla^2\mathbf{E}_s=-k^2\mathbf{E}_s
$$
 with $k=n\omega/c$. For a TE mode with only $E_y$, no $y$ variation, and axial dependence $e^{-j\beta_m z}$, write
$$
E_{ys}=E_0f_m(x)e^{-j\beta_m z}
$$
 Substitution reduces the partial differential equation to
$$
\frac{d^2f_m}{dx^2}+\kappa_m^2f_m=0
$$
 where $\kappa_m^2=k^2-\beta_m^2$. Conducting-wall conditions require $E_y=0$ at $x=0$ and $x=d$. These eliminate the cosine solution and quantize $\kappa_m=m\pi/d$, giving
$$
E_{ys}=E_0\sin\left(\frac{m\pi x}{d}\right)e^{-j\beta_m z}
$$
 Thus the boundary-value method reproduces the transverse-resonance result. The integer $m$ counts the number of spatial half-cycles, or equivalently electric-field maxima, across the plate spacing.

## Page-Grounded Details

#### Page 491

### 13.4 PARALLEL-PLATE GUIDE ANALYSIS USING THE WAVE EQUATION

The most direct approach in the analysis of any waveguide is through the wave equation, which we solve subject to the boundary conditions at the conducting walls. The form of the equation that we will use is that of Eq. (28) in Section 11.1, which was written for the case of free-space propagation. We account for the dielectric properties in the waveguide by replacing $k_{0}$ in that equation with $k$ to obtain:
$$
\nabla^{2} \mathbf{E}_{s} = - k^{2} \mathbf{E}_{s}
$$
(58)

where $k = n\omega/c$ as before.

We can use the results of the last section to help us visualize the process of solving the wave equation. For example, we may consider TE modes first, in which there will be only a $y$ component of $\mathbf{E}$. The wave equation becomes:
$$
\frac{\partial^{2} E_{y s}}{\partial x^{2}} + \frac{\partial^{2} E_{y s}}{\partial y^{2}} + \frac{\partial^{2} E_{y s}}{\partial z^{2}} + k^{2} E_{y s} = 0
$$
(59)

We assume that the width of the guide (in the $y$ direction) is very large compared to the plate separation $d$. Therefore we can assume no $y$ variation in the fields (fringing fields are ignored

[Truncated for analysis]

#### Page 492

$k^{2}-\beta_{m}^{2}=\kappa_{m}^{2}$. Using this in (61) we obtain
$$
\frac{d^{2}f_{m}(x)}{dx^{2}}+\kappa_{m}^{2}f_{m}(x)=0
$$
(62)

The general solution of (62) will be
$$
f_{m}(x)=\cos(\kappa_{m}x)+\sin(\kappa_{m}x)
$$
(63)

We next apply the appropriate boundary conditions in our problem to evaluate $\kappa_{m}$. From Figure 13.6, conducting boundaries appear at $x=0$ and $x=d$, at which the tangential electric field ($E_{y}$) must be zero. In Eq. (63), only the $\sin(\kappa_{m}x)$ term will allow the boundary conditions to be satisfied, so we retain it and drop the cosine term. The $x=0$ condition is automatically satisfied by the sine function. The $x=d$ condition is met when we choose the value of $\kappa_{m}$ such that
$$
\kappa_{m}=\frac{m\pi}{d}
$$
(64)

We recognize Eq. (64) as the same result that we obtained using the transverse resonance condition of Section 13.3. The final form of $E_{ys}$ is obtained by substituting $f_{m}(x)$ as expressed through (63) and (64) into (60), yielding a result that is consistent with the one expressed in Eq. (48):
$$
E_{ys}=E_{0}\sin\left(\frac{m\pi x}{d}\right)e^{-j\beta_{m}z}
$$
(65)

An additional signifi

[Truncated for analysis]

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

- The dielectric wave equation is $\nabla^2\mathbf{E}_s=-k^2\mathbf{E}_s$.
- A wide guide permits neglect of $y$ variation and fringing.
- The assumed axial dependence is $e^{-j\beta_m z}$.
- Separation reduces the problem to a harmonic ordinary differential equation in $x$.
- The tangential electric field must vanish at both conducting plates.
- The boundary conditions select sine functions and $\kappa_m=m\pi/d$.
- Mode number $m$ counts transverse spatial half-cycles and field maxima.

## Source Anchors

- Equations (58) through (62) reduce the vector wave equation to the transverse eigenvalue equation.
- Equation (63) gives the sine and cosine general solution.
- Equation (64) gives $\kappa_m=m\pi/d$ after applying conductor boundary conditions.
- Equation (65) gives the final TE electric-field phasor.
- Equations (66) through (68) interpret the guide at cutoff as a one-dimensional resonant cavity.
- Figure 13.17 illustrates the $m=4$ transverse phase pattern and its changing wave angle.
- Problem D13.9 states that three electric-field maxima imply $m=3$.

## Related Pages

- [[transverse-resonance-and-mode-quantization|Transverse Resonance and Mode Quantization]]
- [[te-mode-fields-from-plane-wave-superposition|TE Mode Fields from Plane-Wave Superposition]]
- [[parallel-plate-te-magnetic-fields|Parallel-Plate TE Magnetic Fields]]

## Concept Dependencies

- enables: [[parallel-plate-te-magnetic-fields|Parallel-Plate TE Magnetic Fields]]
- derives-from: [[transverse-resonance-and-mode-quantization|Transverse Resonance and Mode Quantization]]
