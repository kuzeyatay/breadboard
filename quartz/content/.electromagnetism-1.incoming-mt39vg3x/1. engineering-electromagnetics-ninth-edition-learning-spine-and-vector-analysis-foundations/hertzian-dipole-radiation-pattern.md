---
title: "1.310 Hertzian Dipole Radiation Pattern"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 532", "Page 533", "Figure 14.3", "Section 14.1.3"]
related: ["near-field-and-far-field-behavior", "radiation-intensity-and-solid-angle", "directivity-and-beamwidth", "thin-wire-dipole-current-distribution"]
---

# 1.310 Hertzian Dipole Radiation Pattern

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 532, Page 533, Figure 14.3, Section 14.1.3

The Hertzian dipole's far-zone angular dependence is set by the common $\sin\theta$ factor in $E_{\theta s}$ and $H_{\phi s}$. Radiation is strongest in the equatorial plane perpendicular to the current element, where $\theta=90^\circ$, and vanishes along the dipole axis at $\theta=0^\circ$ and $180^\circ$. The E-plane is any constant-$\phi$ plane containing the electric field and the dipole axis. Plotting normalized field magnitude against $\theta$ gives $|\sin\theta|$, which Figure 14.3 represents as a circular locus in the selected vertical plane. Rotating this pattern around the $z$ axis gives the familiar three-dimensional broadside pattern with no radiation along the axis. The H-plane is any plane normal to the $z$ axis. Since the far fields have no $\phi$ dependence, the H-plane pattern is a circle centered at the origin, indicating uniform radiation with azimuth. This pattern is broad rather than sharply directive. It provides the angular basis for the later intensity, directivity, and beamwidth calculations.

## Page-Grounded Details

#### Page 532

negative amplitudes that differ in each cycle. Second, at distances $r$ that are much greater than a wavelength, the second term in (21) dominates, and the field variation with $r$ approaches that of a pure sinusoid. We may therefore say that, for all practical purposes, the wave at large distances, where $r>>\lambda$, is a uniform plane wave having a sinusoidal variation with distance (and time, of course) and a well-defined wavelength. This wave evidently carries power away from the differential antenna.

We should now take a more careful look at the expressions containing terms varying as $1/r^{3}$, $1/r^{2}$, and $1/r$ in Eqs. (10), (13$a$), and (13$b$). At points very close to the current element, the $1/r^{3}$ term must be dominant. In the numerical example we have used, the relative values of the terms in $1/r^{3}$, $1/r^{2}$, and $1/r$ in the $E_{\theta s}$ expression are about 250, 16, and 1, respectively, when $r$ is 1 cm. The variation of an electric field as $1/r^{3}$ should remind us of the electrostatic field of the dipole (Chapter 4). The development of this concept is the subject of Problem 14.4. The near-field terms represent energy st

[Truncated for analysis]

#### Page 533

Figure 14.3 The polar plot of the $E$-plane pattern of a vertical current element. The crest amplitude of $E_{\theta s}$ is plotted as a function of the polar angle $\theta$ at a constant distance $r$. The locus is a circle.

is simply the coordinate plane that contains the electric field, which in our present case is any surface of constant $\phi$ in the spherical coordinate system. Figure 14.3 shows an $E$-plane plot of Eq. (22) in polar coordinates, in which the relative magnitude of $E_{\theta s}$ is plotted against $\theta$ for a constant $r$. The length of the vector shown in the figure represents the magnitude of $E_{\theta}$, normalized to unity at $\theta=90^{\circ}$; the vector length is just $|\sin\theta|$, and so as $\theta$ varies, the tip of the vector traces out a circle as shown.

A horizontal, or $H$-plane pattern may also be plotted for this or more complicated antenna systems. In the present case, this would show the variation of field intensity with $\phi$. The $H$-plane of the current element (the plane that contains the magnetic field) is any plane that is normal to the $z$ axis. As $E_{\theta}$ is not a function of $\phi$

[Truncated for analysis]

## Core Ideas

- Far-zone field magnitude is proportional to $|\sin\theta|$.
- Radiation maximizes at $\theta=90^\circ$.
- Radiation vanishes along the positive and negative $z$ axis.
- An E-plane contains the electric field and the antenna axis.
- The normalized E-plane field pattern is represented by a circular polar locus.
- The pattern is independent of azimuth $\phi$.
- The H-plane pattern is a circle.
- The broad pattern leads to modest directivity.

## Source Anchors

- Figure 14.3 plots the normalized crest amplitude of $E_{\theta s}$ against $\theta$ at constant $r$.
- The plotted vector length is $|\sin\theta|$.
- The source states that the fields maximize in the $xy$ plane and vanish off the ends of the element.
- Because $E_\theta$ is independent of $\phi$, the H-plane plot is circular.

## Related Pages

- [[near-field-and-far-field-behavior|Near-Field and Far-Field Behavior]]
- [[radiation-intensity-and-solid-angle|Radiation Intensity and Solid Angle]]
- [[directivity-and-beamwidth|Directivity and Beamwidth]]
- [[thin-wire-dipole-current-distribution|Thin-Wire Dipole Current Distribution]]

## Concept Dependencies

- related: [[radiation-intensity-and-solid-angle|Radiation Intensity and Solid Angle]]
- applies-to: [[directivity-and-beamwidth|Directivity and Beamwidth]]
