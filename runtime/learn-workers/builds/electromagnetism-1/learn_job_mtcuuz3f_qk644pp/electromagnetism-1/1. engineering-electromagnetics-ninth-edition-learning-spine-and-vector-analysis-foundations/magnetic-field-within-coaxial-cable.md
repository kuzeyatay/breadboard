---
title: "1.109 Magnetic Field Within a Coaxial Cable"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 204", "Page 205", "Page 206", "Section 7.2.3: Magnetic Field Within a Coaxial Cable", "Figure S1.P205.F1", "Figure S1.P206.F1"]
related: ["ampere-circuital-law-enclosed-current", "ampere-circuital-law-applied-filament", "current-source-representations", "magnetic-fields-solenoids-toroids"]
---

# 1.109 Magnetic Field Within a Coaxial Cable

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 204, Page 205, Page 206, Section 7.2.3: Magnetic Field Within a Coaxial Cable, Figure S1.P205.F1, Figure S1.P206.F1

An infinitely long coaxial cable carries uniformly distributed current $I$ in its inner conductor of radius $a$ and return current $-I$ in its outer conductor between radii $b$ and $c$. Cylindrical symmetry and cancellation of radial components leave only $H_\phi(\rho)$. Ampere's law then produces a piecewise field. Inside the inner conductor, the enclosed fraction is $I\rho^2/a^2$, giving
$$
H_\phi=\frac{I\rho}{2\pi a^2},\qquad \rho<a
$$
Between conductors,
$$
H_\phi=\frac{I}{2\pi\rho},\qquad a<\rho<b
$$
Within the outer conductor, the enclosed return current grows with annular area, giving
$$
H_\phi=\frac{I}{2\pi\rho}\frac{c^2-\rho^2}{c^2-b^2},\qquad b<\rho<c
$$
Outside the cable, equal positive and negative currents are enclosed, so $H_\phi=0$ for $\rho>c$. The field remains continuous at conductor boundaries because infinitesimal path changes enclose only infinitesimal current changes.

## Page-Grounded Details

#### Page 204

#### 7.2.2 Application of Ampere's Law to a Filament Current

Here we again find the magnetic field intensity produced by an infinitely long filament carrying a current $I$. The filament lies on the $z$ axis in free space (as in Figure 7.3), and the current flows in the direction given by $\mathbf{a}_{z}$. Symmetry inspection comes first, showing that there is no variation with $z$ or $\phi$. Next we determine which components of $\mathbf{H}$ are present by using the Biot-Savart law. Without specifically using the cross product, we may say that the direction of $d\mathbf{H}$ is perpendicular to the plane containing $d\mathbf{L}$ and $\mathbf{R}$ and therefore is in the direction of $\mathbf{a}_{\phi}$. Hence the only component of $\mathbf{H}$ is $H_{\phi}$, and it is a function only of $\rho$.

We therefore choose a path, to any section of which $\mathbf{H}$ is either perpendicular or tangential, and along which $H$ is constant. The first requirement (perpendicularity or tangency) allows us to replace the dot product of Ampère's circuital law with the product of the scalar magnitudes, except along that portion of the path where $\mathbf{H}$ is normal

[Truncated for analysis]

#### Page 205

Figure 7.8 (a) Cross section of a coaxial cable carrying a uniformly distributed current / in the inner conductor and -/ in the outer conductor. The magnetic field at any point is most easily determined by applying Ampère's circuital law about a circular path. (b) Current filaments at $\rho = \rho_1$, $\phi = \pm \phi_1$, produces $H_p$ components which cancel. For the total field, $H = H_\phi a_\phi$.

If we choose $\rho$ smaller than the radius of the inner conductor, the current enclosed is
$$
I_{\text{encl}} = I\frac{\rho^{2}}{a^{2}}
$$
and
$$
2\pi\rho H_{\phi} = I\frac{\rho^{2}}{a^{2}}
$$
or
$$
H_{\phi} = \frac{I\rho}{2\pi a^{2}} \quad (\rho < a)
$$
If the radius $\rho$ is larger than the outer radius of the outer conductor, no current is enclosed and
$$
H_{\phi} = 0 \quad (\rho > c)
$$
Finally, if the path lies within the outer conductor, we have
$$
2\pi\rho H_{\phi} = I - I\left( \frac{\rho^{2} - b^{2}}{c^{2} - b^{2}} \right)
$$
$$
H_{\phi} = \frac{I}{2\pi\rho} \frac{c^{2} - \rho^{2}}{c^{2} - b^{2}} \quad (b < \rho < c)
$$
The magnetic-field-strength variation with radius is shown in Figure 7.9 for a coaxial cable in which $b = 3a$, $c = 4a$. It should be noted th

[Truncated for analysis]

#### Page 206

Figure 7.9 The magnetic field intensity as a function of radius in an infinitely long coaxial transmission line with the dimensions shown.

The external field is zero. This, we see, results from equal positive and negative currents enclosed by the path. Each produces an external field of magnitude $I/2\pi\rho$, but complete cancellation occurs. This is another example of "shielding"; such a coaxial cable carrying large currents would, in principle, not produce any noticeable effect in an adjacent circuit.

#### 7.2.4 Magnetic Field of a Surface Current

As a final example, consider a sheet of current flowing in the positive $y$ direction and located in the $z=0$ plane. We may think of the return current as equally divided between two distant sheets on either side of the sheet we are considering. A sheet of uniform surface current density $\mathbf{K}=K_{y}\mathbf{a}_{y}$ is shown in Figure 7.10. $\mathbf{H}$ cannot vary with $x$ or $y$. If the sheet is subdivided into a number of filaments, it is evident that no filament can produce an $H_{y}$ component. Moreover, the Biot-Savart law shows that the contributions to $H_{z}$ produced by a symmetrically located pair o

[Truncated for analysis]

## Core Ideas

- Coaxial symmetry leaves only an azimuthal field component.
- Uniform inner-conductor current makes enclosed current proportional to $\rho^2$.
- The field increases linearly with $\rho$ inside the center conductor.
- The field decreases as $1/\rho$ in the dielectric region.
- The field decreases to zero through the outer conductor.
- The external field is zero because the total enclosed current is $I-I=0$.
- The field is continuous at $\rho=a$, $\rho=b$, and $\rho=c$.

## Source Anchors

- Figure S1.P205.F1 shows the coaxial cross section and cancellation of radial components from symmetric filaments.
- Page 204 gives $H_\phi=I/(2\pi\rho)$ for $a<\rho<b$.
- Page 205 gives $I_{\mathrm{encl}}=I\rho^2/a^2$ for $\rho<a$.
- Page 205 gives the outer-conductor expression $H_\phi=I(c^2-\rho^2)/[2\pi\rho(c^2-b^2)]$.
- Page 205 gives $H_\phi=0$ for $\rho>c$.
- Figure S1.P206.F1 plots field intensity against radius for $b=3a$ and $c=4a$.
- Page 206 identifies the zero external field as shielding caused by cancellation of equal opposite currents.

## Related Pages

- [[ampere-circuital-law-enclosed-current|Ampere's Circuital Law and Enclosed Current]]
- [[ampere-circuital-law-applied-filament|Ampere's Circuital Law Applied to a Filament]]
- [[current-source-representations|Current Source Representations]]
- [[magnetic-fields-solenoids-toroids|Magnetic Fields of Solenoids and Toroids]]

## Concept Dependencies

- applies-to: [[ampere-circuital-law-enclosed-current|Ampere's Circuital Law and Enclosed Current]]
- depends-on: [[current-source-representations|Current Source Representations]]
- depends-on: [[ampere-circuital-law-applied-filament|Ampere's Circuital Law Applied to a Filament]]
