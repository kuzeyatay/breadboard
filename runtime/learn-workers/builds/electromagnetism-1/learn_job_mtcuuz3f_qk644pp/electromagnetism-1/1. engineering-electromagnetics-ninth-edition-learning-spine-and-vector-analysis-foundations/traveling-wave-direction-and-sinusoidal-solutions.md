---
title: "1.215 Traveling-Wave Direction and Sinusoidal Solutions"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 383", "Page 384", "Page 385"]
related: ["free-space-electromagnetic-wave-equation", "phasor-representation-of-uniform-plane-waves", "lossy-dielectric-propagation-and-complex-wavenumber"]
---

# 1.215 Traveling-Wave Direction and Sinusoidal Solutions

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 383, Page 384, Page 385

The one-dimensional free-space wave equation admits arbitrary forward- and backward-traveling functions, $f_1(t-z/v)$ and $f_2(t+z/v)$. For sinusoidal steady-state fields, these become cosine waves whose signs in the spatial phase term reveal their directions. A phase of $\omega t-k_0z$ moves toward increasing $z$, while $\omega t+k_0z$ moves toward decreasing $z$. This can be proven by holding the phase of a selected crest constant: as time increases, $z$ must increase for the negative spatial sign and decrease for the positive spatial sign. In free space the phase velocity is $c$, and the wavenumber is $k_0=\omega/c$ in radians per meter. Wavenumber is the spatial analogue of angular frequency, measuring phase shift per unit distance. The wavelength is the distance that produces a $2\pi$ phase change, so $\lambda=2\pi/k_0$. These relationships provide the foundation for interpreting both real instantaneous fields and their phasor representations.

## Page-Grounded Details

#### Page 383

Equations (5) and (6) can be more succinctly written:
$$
\frac{\partial E_{x}}{\partial z}=-\mu_{0}\frac{\partial H_{y}}{\partial t}\quad{(7)}
$$
$$
\frac{\partial H_{y}}{\partial z}=-\epsilon_{0}\frac{\partial E_{x}}{\partial t}\quad{(8)}
$$
These equations compare directly with the telegraphist's equations for the lossless transmission line [Eqs. (20) and (21) in Chapter 10]. Further manipulations of (7) and (8) proceed in the same manner as was done with the telegraphist's equations. Specifically, we differentiate (7) with respect to z, obtaining:
$$
\frac{\partial^{2}E_{x}}{\partial z^{2}}=-\mu_{0}\frac{\partial^{2}H_{y}}{\partial t\partial z}\quad{(9)}
$$
Then, (8) is differentiated with respect to t:
$$
\frac{\partial^{2}H_{y}}{\partial z\partial t}=-\epsilon_{0}\frac{\partial^{2}E_{x}}{\partial t^{2}}\quad{(10)}
$$
Substituting (10) into (9) results in
$$
\frac{\partial^{2}E_{x}}{\partial z^{2}}=\mu_{0}\epsilon_{0}\frac{\partial^{2}E_{x}}{\partial t^{2}}\quad{(11)}
$$
This equation, in direct analogy to Eq. (13) in Chapter 10, we identify as the wave equation for our x-polarized TEM electric field in free space. From Eq. (11), we further identify the propagation vel

[Truncated for analysis]

#### Page 384

From here, we immediately specialize to sinusoidal functions of a specified frequency and write the solution to (11) in the form of forward- and backward-propagating cosines. Because the waves are sinusoidal, we denote their velocity as the phase velocity, $v_{p}$. The waves are written as:
$$
\begin{array}[]{ll}E_{x}(z,t)&=\mathscr{E}_{x}(z,t)+\mathscr{E}_{x}^{{}^{\prime}}(z,t)\\ &=\left|E_{x0}\right|\cos\left[\omega(t-z/v_{p})+\phi_{1}\right]+\left|E_{x0}^{{}^{\prime}}\right|\cos\left[\omega(t+z/v_{p})+\phi_{2}\right]\\ &=\underbrace{\left|E_{x0}\right|\cos[\omega t-k_{0}z+\phi_{1}]}_{\text{forward }z\text{ travel}}+\underbrace{\left|E_{x0}^{{}^{\prime}}\right|\cos[\omega t+k_{0}z+\phi_{2}]}_{\text{backward }z\text{ travel}}\end{array} (15)
$$
In writing the second line of (15), we have used the fact that the waves are traveling in free space, in which case the phase velocity $v_{p}=c$. Additionally, the wavenumber in free space is defined as
$$
k_{0}\equiv\frac{\omega}{c}\text{ rad/m} (16)
$$
In a manner consistent with our transmission line studies, we refer to the solutions expressed in (15) as the real instantaneous forms of the electric field. They are the mathematic

[Truncated for analysis]

#### Page 385

$(\omega t+k_{0}z)$ describes a wave that moves in the negative $z$ direction, since as time in-creases, $z$ must now decrease to keep the argument constant. For simplicity, we will restrict our attention in this chapter to only the positive $z$ traveling wave.

As was done for transmission line waves, we express the real instantaneous fields of Eq. (15) in terms of their phasor forms. Using the forward-propagating field in (15), we write:
$$
\mathcal{E}_{x}(z,t)=\frac{1}{2}\underbrace{\left[E_{x0}\right]}_{E_{x0}}e^{j\phi_{1}}e^{-jk_{0}z}e^{j\omega t}+c.c.=\frac{1}{2}E_{xs}e^{j\omega t}+c.c.=\mathcal{R}e[E_{xs}e^{j\omega t}]\quad{(19)}
$$
where $c.c$ denotes the complex conjugate, and where we identify the phasor electric field as $E_{xs}=E_{x0}e^{-jk_{0}z}$. As indicated in (19), $E_{x0}$ is the complex amplitude (which includes the phase, $\phi_{1}$).

#### Example 11.1

Let us express $\mathcal{E}_{y}(z,t)=100\cos(10^{8}t-0.5z+30^{\circ})$ V/m as a phasor.

Solution. We first go to exponential notation,
$$
\mathcal{E}_{y}(z,t)=\mathcal{R}e[100e^{j(10^{8}t-0.5z+30^{\circ})}]
$$
and then drop Re and suppress $e^{j10^{8}t}$, obtaining the phasor
$$ E_{ys}

[Truncated for analysis]

## Core Ideas

- The general solution is $E_x(z,t)=f_1(t-z/v)+f_2(t+z/v)$.
- The phase $\omega t-k_0z$ represents propagation in the positive $z$ direction.
- The phase $\omega t+k_0z$ represents propagation in the negative $z$ direction.
- In free space, phase velocity is $v_p=c$.
- The free-space wavenumber is $k_0=\omega/c$ in rad/m.
- Wavelength satisfies $k_0\lambda=2\pi$ and $\lambda=2\pi/k_0$.
- Holding a crest's phase constant provides a direct propagation-direction test.

## Source Anchors

- Equation (14) gives $E_x(z,t)=f_1(t-z/v)+f_2(t+z/v)$.
- Equation (15) gives forward and backward cosine terms with phases $\omega t-k_0z+\phi_1$ and $\omega t+k_0z+\phi_2$.
- Equation (16) defines $k_0\equiv\omega/c$ rad/m.
- Equation (17) derives $\lambda=2\pi/k_0$ from a $2\pi$ spatial phase change.
- Equation (18) tracks a forward crest through $\omega(t-z/c)=2m\pi$.

## Related Pages

- [[free-space-electromagnetic-wave-equation|Free-Space Electromagnetic Wave Equation]]
- [[phasor-representation-of-uniform-plane-waves|Phasor Representation of Uniform Plane Waves]]
- [[lossy-dielectric-propagation-and-complex-wavenumber|Lossy Dielectric Propagation and Complex Wavenumber]]

## Concept Dependencies

- derives-from: [[free-space-electromagnetic-wave-equation|Free-Space Electromagnetic Wave Equation]]
- enables: [[phasor-representation-of-uniform-plane-waves|Phasor Representation of Uniform Plane Waves]]
- related: [[lossy-dielectric-propagation-and-complex-wavenumber|Lossy Dielectric Propagation and Complex Wavenumber]]
