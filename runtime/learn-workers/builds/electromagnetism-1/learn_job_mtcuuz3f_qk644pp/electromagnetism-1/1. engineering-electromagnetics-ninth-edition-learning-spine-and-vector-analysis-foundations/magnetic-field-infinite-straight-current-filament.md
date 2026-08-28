---
title: "1.105 Magnetic Field of an Infinite Straight Current Filament"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 198", "Page 199", "Page 200", "Section 7.1.3: Magnetic Field of a Current Filament", "Figure S1.P198.F1", "Figure S1.P199.F1"]
related: ["differential-biot-savart-law", "finite-straight-current-filaments-superposition", "ampere-circuital-law-applied-filament", "physical-meaning-of-curl"]
---

# 1.105 Magnetic Field of an Infinite Straight Current Filament

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 198, Page 199, Page 200, Section 7.1.3: Magnetic Field of a Current Filament, Figure S1.P198.F1, Figure S1.P199.F1

For an infinitely long current filament on the $z$ axis carrying current $I$ in the $+z$ direction, symmetry eliminates dependence on $z$ and $\phi$. At a field point $\mathbf{r}=\rho\mathbf{a}_\rho$ in the $z=0$ plane, a source point is $\mathbf{r}'=z'\mathbf{a}_z$, so
$$
\mathbf{R}_{12}=\rho\mathbf{a}_\rho-z'\mathbf{a}_z
$$
With $d\mathbf{L}=dz'\mathbf{a}_z$, the cross product leaves only an $\mathbf{a}_\phi$ component. Integration from $z'=-\infty$ to $z'=\infty$ gives
$$
\mathbf{H}=\frac{I}{2\pi\rho}\mathbf{a}_\phi
$$
The cylindrical unit vector $\mathbf{a}_\phi$ may be moved outside this particular integral because it varies with $\phi$, while the integration variable is $z'$. The field is circumferential, independent of $z$ and $\phi$, and inversely proportional to radial distance $\rho$. Its streamlines are concentric circles centered on the filament, with direction determined by the right-hand rule.

## Page-Grounded Details

#### Page 198

Figure 7.3 An infinitely long, straight filament carrying a direct current $\textit{I}$. The field at point 2 is $\mathbf{H} = (\textit{I}/2\pi\rho)\mathbf{a}_{\phi}$.

#### 7.1.3 Magnetic Field of a Current Filament

We illustrate an application of the Biot-Savart law by considering an infinitely long straight filament. We apply (2) first and then integrate. This, of course, is the same as using the integral form (3) in the first place.^2

Referring to Figure 7.3, we should recognize the symmetry of this field. No variation with $z$ or with $\phi$ can exist. Point 2, at which we will determine the field, is therefore chosen in the $z=0$ plane. The field point $\mathbf{r}$ is therefore $r=\rho\mathbf{a}_{\rho}$. The source point $\mathbf{r}^{\prime}$ is given by $\mathbf{r}^{\prime}=z^{\prime}\mathbf{a}_{z}$, and therefore
$$
\mathbf{R}_{12}=\mathbf{r}-\mathbf{r}^{\prime}=\rho\mathbf{a}_{\rho}-z^{\prime}\mathbf{a}_{z}
$$
so that
$$
\mathbf{a}_{R12}=\frac{\rho\mathbf{a}_{\rho}-z^{\prime}\mathbf{a}_{z}}{\sqrt{\rho^{2}+z^{\prime 2}}}
$$
We take $d\mathbf{L}=dz^{\prime}\mathbf{a}_{z}$ and (2) becomes
$$
d\mathbf{H}_{2}=\frac{I\,dz^{\prime}\mathbf{a}_{z}\times(\

[Truncated for analysis]

#### Page 199

Figure 7.4 The streamlines of the magnetic field intensity about an infinitely long straight filament carrying a direct current $\textit{I}$. The direction of $\textit{I}$ is into the page.

At this point the unit vector $\mathbf{a}_{\phi}$ under the integral sign should be investigated, for it is not always a constant, as are the unit vectors of the rectangular coordinate system. A vector is constant when its magnitude and direction are both constant. The unit vector certainly has constant magnitude, but its direction may change. Here $\mathbf{a}_{\phi}$ changes with the coordinate $\phi$ but not with $\rho$ or $z$. Fortunately, the integration here is with respect to $z^{\prime}$, and $\mathbf{a}_{\phi}$ is a constant and may be removed from under the integral sign
$$
 \begin{align*}\mathbf{H}_{2}&=\frac{I\rho\mathbf{a}_{\phi}}{4\pi}\int_{-\infty}^{\infty}\frac{dz^{\prime}}{(\rho^{2}+z^{\prime 2})^{3/2}}\\ &=\frac{I\rho\mathbf{a}_{\phi}}{4\pi}\frac{z^{\prime}}{\rho^{2}\sqrt{\rho^{2}+z^{\prime 2}}}\bigg|_{-\infty}^{\infty}\end{align*}
$$
and
$$
 \mathbf{H}_{2}=\frac{I}{2\pi\rho}\mathbf{a}_{\phi}\quad{(8)} $$
The magnitude of the field is not a function of $ \p

[Truncated for analysis]

#### Page 200

has been adjusted so that the addition of this second set of lines will produce an array of curvilinear squares.

A comparison of Figure 7.4 with the map of the $electric$ field about an infinite line $charge$ shows that the streamlines of the magnetic field correspond exactly to the equipotentials of the electric field, and the unnamed (and undrawn) perpendicular family of lines in the magnetic field corresponds to the streamlines of the electric field. This correspondence is not an accident, but there are several other concepts which must be mastered before the analogy between electric and magnetic fields can be explored more thoroughly.

Using the Biot-Savart law to find $\mathbf{H}$ is in many respects similar to the use of Coulomb's law to find $\mathbf{E}$. Each requires the determination of a moderately complicated integrand containing vector quantities, followed by an integration. When we were concerned with Coulomb's law we solved a number of examples, including the fields of the point charge, line charge, and sheet of charge. The law of Biot-Savart can be used to solve analogous problems in magnetic fields, and some of these problems appear as exercises at the end

[Truncated for analysis]

## Core Ideas

- Cylindrical symmetry makes $\mathbf{H}$ independent of $z$ and $\phi$.
- The cross product selects the azimuthal direction $\mathbf{a}_\phi$.
- The source coordinate is integrated from $-\infty$ to $\infty$.
- The result is $\mathbf{H}=I\mathbf{a}_\phi/(2\pi\rho)$.
- The field magnitude decreases as $1/\rho$.
- The field streamlines are circles around the current filament.
- A curvilinear unit vector may leave an integral only if it is constant with respect to the integration variable.

## Source Anchors

- Figure S1.P198.F1 defines the infinite-filament geometry and states $\mathbf{H}=(I/2\pi\rho)\mathbf{a}_\phi$.
- Page 198 constructs $\mathbf{R}_{12}=\rho\mathbf{a}_\rho-z'\mathbf{a}_z$.
- Pages 198-199 show the Biot-Savart integration over $z'$.
- Page 199 explains why $\mathbf{a}_\phi$ is constant during integration with respect to $z'$.
- Page 199 gives the final result $\mathbf{H}=I\mathbf{a}_\phi/(2\pi\rho)$.
- Figure S1.P199.F1 maps the circular magnetic-field streamlines for current directed into the page.
- Page 200 compares the circular magnetic streamlines with the equipotentials of an infinite electric line charge.

## Related Pages

- [[differential-biot-savart-law|Differential Biot-Savart Law]]
- [[finite-straight-current-filaments-superposition|Finite Straight Current Filaments and Superposition]]
- [[ampere-circuital-law-applied-filament|Ampere's Circuital Law Applied to a Filament]]
- [[physical-meaning-of-curl|Physical Meaning of Curl]]

## Concept Dependencies

- applies-to: [[differential-biot-savart-law|Differential Biot-Savart Law]]
