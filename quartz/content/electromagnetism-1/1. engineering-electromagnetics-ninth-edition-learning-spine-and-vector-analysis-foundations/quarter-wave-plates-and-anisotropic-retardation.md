---
title: "1.238 Quarter-Wave Plates and Anisotropic Retardation"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 414, anisotropic-crystal and quarter-wave-plate discussion", "Page 419, Problems 11.30 and 11.31", "Page 420, Problem 11.32"]
related: ["circular-polarization-handedness-and-field-rotation", "circularly-polarized-wave-phasors", "linear-polarization-as-opposite-circular-components", "optical-rotation-from-circular-birefringence"]
---

# 1.238 Quarter-Wave Plates and Anisotropic Retardation

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 414, anisotropic-crystal and quarter-wave-plate discussion, Page 419, Problems 11.30 and 11.31, Page 420, Problem 11.32

An anisotropic material has a permittivity that depends on electric-field direction. A crystal can therefore present different permittivities, phase velocities, and phase constants to waves polarized along two orthogonal axes. To generate circular polarization, a linearly polarized input is oriented at $45^\circ$ to the crystal's $x$ and $y$ axes. This produces equal-amplitude components along those axes. Because the two components propagate at different speeds, they accumulate a relative phase delay as they travel through the crystal. If the crystal length is chosen so that the output phase difference is $\pi/2$, the equal-amplitude orthogonal components form a circularly polarized wave. A device cut to this length is called a quarter-wave plate because a phase shift of $\pi/2$ is one quarter of a full $2\pi$ cycle and is equivalent to a path retardation of $\lambda/4$. The chapter problems extend this principle by asking where linear and circular states recur as the phase difference $\Delta\beta z$ increases.

## Page-Grounded Details

#### Page 414

light can be passed through a polarizer of any orientation, thus yielding linearly polarized light in any direction (although one loses half the original power this way). Other uses involve treating linearly polarized light as a superposition of circularly polarized waves, to be described next.

Circularly polarized light can be generated using an anisotropic medium-a material whose permittivity is a function of electric field direction. Many crystals have this property. A crystal orientation can be found such that along one direction (say, the x axis), the permittivity is lowest, while along the orthogonal direction (y axis), the permittivity is highest. The strategy is to input a linearly polarized wave with its field vector at 45 degrees to the x and y axes of the crystal. It will thus have equal-amplitude x and y components in the crystal, and these will now propagate in the z direction at different speeds. A phase difference (or retardation) accumulates between the components as they propagate, which can reach π/2 if the crystal is long enough. The wave at the output thus becomes circularly polarized. Such a crystal, cut to the right length and used in this manner, is called a

[Truncated for analysis]

#### Page 419

11.25  A good conductor is planar in form, and it carries a uniform plane wave that has a wavelength of 0.3 mm and a velocity of $3\times10^{5}$ m/s. Assuming the conductor is nonmagnetic, determine the frequency and the conductivity.

11.26  The dimensions of a certain coaxial transmission line are a= 0.8 mm and b= 4 mm. The outer conductor thickness is 0.6 mm, and all conductors have $\sigma=1.6\times10^{7}$ S/m. (a) Find R, the resistance per unit length at an operating frequency of 2.4 GHz. (b) Use information from Sections 6.3 and 8.10 to find C and L, the capacitance and inductance per unit length, respectively. The coax is air-filled. (c) Find $\alpha$ and $\beta$ if $\alpha+j\beta=\sqrt{j\omega C(R+j\omega L)}$.

11.27  The planar surface z= 0 is a brass-Teflon interface. Use data available in Appendix C to evaluate the following ratios for a uniform plane wave having $\omega=4\times10^{10}$ rad/s: (a) $\alpha_{\text{Tef}}/\alpha_{\text{brass}}$; (b) $\lambda_{\text{Tef}}/\lambda_{\text{brass}}$; (c) $v_{\text{Tef}}/v_{\text{brass}}$.

11.28  A uniform plane wave in free space has electric field vector given by $ E_{s}=10e^{-j\beta x}a_{z}+15e^{-j\beta x}a

[Truncated for analysis]

#### Page 420

11.32  Suppose that the length of the medium of Problem 11.31 is made to be twice that determined in the problem. Describe the polarization of the output wave in this case.

11.33 Given a wave for which $\mathbf{E}_{s}=15e^{-j\beta z}\mathbf{a}_{x}+18e^{-j\beta z}e^{j\phi}\mathbf{a}_{y}$ V/m in a medium characterized by complex intrinsic impedance $\eta(a)$, find $\mathbf{H}_{s}$. (b) Determine the average power density in $W/m^{2}$.

11.34 Given a general elliptically polarized wave as per Eq. (93):
$$
\mathbf{E}_{s}=[E_{x0}\mathbf{a}_{x}+E_{y0}e^{j\phi}\mathbf{a}_{y}]e^{-j\beta z}
$$
(a) Show, using methods similar to those of Example 11.7, that a linearly polarized wave results when superimposing the given field and a phase-shifted field of the form:
$$
\mathbf{E}_{s}=[E_{x0}\mathbf{a}_{x}+E_{y0}e^{-j\phi}\mathbf{a}_{y}]e^{-j\beta z}e^{j\delta}
$$
where $\delta$ is a constant. (b) Find $\delta$ in terms of $\phi$ such that the resultant wave is linearly polarized along $x$.

## Core Ideas

- Anisotropic permittivity varies with electric-field orientation.
- Orthogonal crystal axes can support different propagation speeds.
- A $45^\circ$ linearly polarized input produces equal $x$ and $y$ field amplitudes.
- Differential propagation accumulates a relative phase delay.
- Equal orthogonal amplitudes with a $\pi/2$ phase difference produce circular polarization.
- A quarter-wave plate introduces a relative retardation equivalent to $\lambda/4$.
- For phase-constant difference $\Delta\beta$, the accumulated relative phase is $\Delta\beta z$.

## Source Anchors

- Page 414 describes a crystal with lowest permittivity along one axis and highest permittivity along the orthogonal axis.
- The input field is placed at $45^\circ$ to the crystal axes to obtain equal-amplitude components.
- The crystal is cut so that the components accumulate a $\pi/2$ relative phase shift.
- The text identifies $\pi/2$ retardation as equivalent to $\lambda/4$.
- Problem 11.30 gives $\mathbf{E}_s(z)=E_0(\mathbf{a}_x+\mathbf{a}_y e^{j\Delta\beta z})e^{-j\beta z}$ with $\Delta\beta=\beta_x-\beta_y$.
- Problems 11.31 and 11.32 ask for the shortest material length producing circular polarization and the state produced by twice that length.

## Related Pages

- [[circular-polarization-handedness-and-field-rotation|Circular Polarization Handedness and Field Rotation]]
- [[circularly-polarized-wave-phasors|Circularly Polarized Wave Phasors]]
- [[linear-polarization-as-opposite-circular-components|Linear Polarization as Opposite Circular Components]]
- [[optical-rotation-from-circular-birefringence|Optical Rotation from Circular Birefringence]]

## Concept Dependencies

- enables: [[circular-polarization-handedness-and-field-rotation|Circular Polarization Handedness and Field Rotation]]
- applies-to: [[circularly-polarized-wave-phasors|Circularly Polarized Wave Phasors]]
