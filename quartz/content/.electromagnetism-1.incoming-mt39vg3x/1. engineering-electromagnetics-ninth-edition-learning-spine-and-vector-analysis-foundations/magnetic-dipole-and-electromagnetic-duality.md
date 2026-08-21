---
title: "1.315 Magnetic Dipole and Electromagnetic Duality"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 539", "Page 540", "Section 14.3", "Figure 14.5"]
related: ["radiation-from-time-varying-currents-and-the-hertzian-dipole-model", "general-electromagnetic-fields-of-a-hertzian-dipole", "near-field-and-far-field-behavior"]
---

# 1.315 Magnetic Dipole and Electromagnetic Duality

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 539, Page 540, Section 14.3, Figure 14.5

A small circular current loop acts as a magnetic dipole whose field pattern is dual to that of the electric Hertzian dipole. The loop has radius $a$, lies in the $xy$ plane, is centered at the origin, and carries $I(t)=I_0\cos\omega t$. Rather than deriving its fields from the retarded potential again, the source exploits electromagnetic duality. In a source-free medium, Maxwell's equations retain their form under the substitutions $\mathbf{E}\to\mathbf{H}$, $\mathbf{H}\to-\mathbf{E}$, $\epsilon\to\mu$, and $\mu\to\epsilon$. A static-axis comparison between the electric dipole and current loop establishes the required source substitution. The electric dipole moment term is related to the loop area $\pi a^2$ using the harmonic current-charge relation $I_0=j\omega Q$. Applying the duality substitutions to the Hertzian-dipole fields produces the loop components $E_{\phi s}$, $H_{rs}$, and $H_{\theta s}$. In the far field, only $E_{\phi s}$ and $H_{\theta s}$ survive. The electric and magnetic roles are interchanged, but the angular field pattern remains the same.

## Page-Grounded Details

#### Page 539

#### 14.3 MAGNETIC DIPOLE

An interesting device that is closely related to the Hertzian dipole is the magnetic dipole antenna. Shown in Figure 14.5, the antenna consists of a circular current loop of radius $a$, centered at the origin, and in the $xy$ plane. The loop current is sinusoidal and is given by $I(t)=I_{0}\cos\omega t$, as was the case in the Hertzian dipole. Although it is possible to work out the fields for this antenna, beginning with the retarded potentials as in the previous section, there is a much faster way.

We first note that the circulating current implies the existence of a circulating electric field that overlaps the wire and that has the same time dependence. So one could simply replace the wire with a circular electric field that we could designate as $\mathbf{E}(a,t)=E_{0}(a)\cos(\omega t)\,\mathbf{a}_{\phi}$. Such a change would replace conduction current with displacement current, which will have no effect on the surrounding field solutions for $\mathbf{E}$ and $\mathbf{H}$. Next, suppose that we could replace the electric field with a magnetic field, again of the form $\mathbf{H}(a,t)=H_{0}\cos(\omega t)\,\mathbf{a}_{\phi}$. This is the m

[Truncated for analysis]

#### Page 540

By inspection, we see that the equations would be unchanged if we replaced E with H, H with -E, e with $\mu$, and $\mu$ with $e$. This illustrates the concept of duality in electromagnetics. The fact that the current loop electric field will have the same functional form as the electric dipole magnetic field means that with the above substitutions, we can construct the current loop fields directly from the electric dipole results. It is because of this duality between field solutions of the two devices that the name, magnetic dipole antenna, is applied to the current loop device.

Before making the substitutions, we must relate the currents and geometries of the two devices. To do this, consider first the static electric dipole result of Chapter 4 [Eq. (35)]. We can specialize this result by finding the electric field on the $z$ axis ($\theta=0$). We find
$$
E|_{\theta=0}=\frac{Qd}{2\pi\,e\,z^{3}}a_{z}
$$
(45)

We can next study the current loop magnetic field as found on the $z$ axis, in which a steady current $I_{0}$ is present. This result can be obtained using the Biot-Savart law:
$$
H|_{\theta=0}=\frac{\pi a^{2}I_{0}}{2\pi\,z^{3}}a_{z}
$$
(46)

Now the curren

[Truncated for analysis]

## Core Ideas

- A small current loop is called a magnetic dipole antenna.
- The loop lies in the $xy$ plane and carries sinusoidal current.
- Electric and magnetic dipoles have identical pattern shapes with field roles interchanged.
- Source-free Maxwell equations exhibit electric-magnetic duality.
- The substitutions include $\mathbf{E}\to\mathbf{H}$ and $\mathbf{H}\to-\mathbf{E}$.
- Permittivity and permeability are also interchanged.
- The loop source strength contains its area $\pi a^2$.
- In the far zone, $E_{\phi s}$ and $H_{\theta s}$ are the surviving loop fields.

## Source Anchors

- Figure 14.5 shows electric and magnetic dipoles as dual structures with interchanged $\mathbf{E}$ and $\mathbf{H}$ roles.
- The source-free equations include $\nabla\times\mathbf{H}=\epsilon\,\partial\mathbf{E}/\partial t$ and $\nabla\times\mathbf{E}=-\mu\,\partial\mathbf{H}/\partial t$.
- The static electric-dipole axis field is
$$
\mathbf{E}|_{\theta=0}=\frac{Qd}{2\pi\epsilon z^3}\mathbf{a}_z
$$
- The static current-loop axis field is
$$
\mathbf{H}|_{\theta=0}=\frac{\pi a^2I_0}{2\pi z^3}\mathbf{a}_z
$$
- The harmonic relation is
$$
I_0=j\omega Q\quad\Rightarrow\quad Q=\frac{I_0}{j\omega}
$$
- The source states that the substitution $d\to j\omega\epsilon(\pi a^2)$, together with the field and material exchanges, transforms the electric-dipole solution into the loop solution.
- The loop field equations are given as Eqs. (48) through (50).

## Related Pages

- [[radiation-from-time-varying-currents-and-the-hertzian-dipole-model|Radiation from Time-Varying Currents and the Hertzian Dipole Model]]
- [[general-electromagnetic-fields-of-a-hertzian-dipole|General Electromagnetic Fields of a Hertzian Dipole]]
- [[near-field-and-far-field-behavior|Near-Field and Far-Field Behavior]]

## Concept Dependencies

- derives-from: [[general-electromagnetic-fields-of-a-hertzian-dipole|General Electromagnetic Fields of a Hertzian Dipole]]
- related: [[radiation-from-time-varying-currents-and-the-hertzian-dipole-model|Radiation from Time-Varying Currents and the Hertzian Dipole Model]]
