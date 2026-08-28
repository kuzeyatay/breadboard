---
title: "1.239 Circularly Polarized Wave Phasors"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 414, Equations (100) and (101)", "Page 419, Problem 11.29"]
related: ["circular-polarization-handedness-and-field-rotation", "linear-polarization-as-opposite-circular-components", "plane-wave-field-and-power-analysis-procedures"]
---

# 1.239 Circularly Polarized Wave Phasors

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 414, Equations (100) and (101), Page 419, Problem 11.29

Circular polarization is represented compactly in phasor form by combining equal-amplitude orthogonal components in phase quadrature. For propagation in the positive $z$ direction, the electric-field phasor is
$$
\mathbf{E}_s=E_0(\mathbf{a}_x\pm j\mathbf{a}_y)e^{-j\beta z}
$$
 This follows from writing the relative phase factor as $e^{\pm j\pi/2}=\pm j$. Under the convention used in the text, the plus sign denotes left circular polarization and the minus sign denotes right circular polarization for positive $z$ propagation. For negative $z$ propagation, the spatial factor becomes $e^{+j\beta z}$ and the handedness associated with each sign reverses: the plus sign denotes right circular polarization and the minus sign denotes left circular polarization. Thus handedness cannot be inferred from the component sign alone. The direction of propagation and the viewing convention must also be known. The representation supplies the basis for finding magnetic fields, power density, and superpositions of circular components.

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

## Core Ideas

- Circular polarization requires equal orthogonal amplitudes and a relative phase of $\pm\pi/2$.
- The identity $e^{\pm j\pi/2}=\pm j$ produces the compact phasor form.
- For positive $z$ travel, $\mathbf{E}_s=E_0(\mathbf{a}_x\pm j\mathbf{a}_y)e^{-j\beta z}$.
- For positive $z$ travel, plus denotes left circular and minus denotes right circular polarization.
- For negative $z$ travel, the propagation factor is $e^{+j\beta z}$.
- For negative $z$ travel, plus denotes right circular and minus denotes left circular polarization.
- Propagation direction is essential when assigning handedness.

## Source Anchors

- Equation (100) gives $\mathbf{E}_s=E_0(\mathbf{a}_x\pm j\mathbf{a}_y)e^{-j\beta z}$.
- The text assigns the plus sign to left circular and the minus sign to right circular polarization in Eq. (100).
- Equation (101) gives $\mathbf{E}_s=E_0(\mathbf{a}_x\pm j\mathbf{a}_y)e^{+j\beta z}$ for negative $z$ propagation.
- For Eq. (101), the positive sign applies to right circular and the negative sign to left circular polarization.
- Problem 11.29 asks for the magnetic-field phasor and average power density of a left circularly polarized free-space wave.

## Related Pages

- [[circular-polarization-handedness-and-field-rotation|Circular Polarization Handedness and Field Rotation]]
- [[linear-polarization-as-opposite-circular-components|Linear Polarization as Opposite Circular Components]]
- [[plane-wave-field-and-power-analysis-procedures|Plane-Wave Field and Power Analysis Procedures]]

## Concept Dependencies

- enables: [[linear-polarization-as-opposite-circular-components|Linear Polarization as Opposite Circular Components]]
- applies-to: [[plane-wave-field-and-power-analysis-procedures|Plane-Wave Field and Power Analysis Procedures]]
