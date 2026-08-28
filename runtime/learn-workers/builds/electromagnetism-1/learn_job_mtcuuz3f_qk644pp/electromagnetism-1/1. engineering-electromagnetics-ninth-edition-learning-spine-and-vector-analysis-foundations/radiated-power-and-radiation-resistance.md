---
title: "1.311 Radiated Power and Radiation Resistance"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 533", "Page 534", "Section 14.2.1"]
related: ["near-field-and-far-field-behavior", "radiation-intensity-and-solid-angle", "directivity-and-beamwidth", "antenna-gain-and-radiation-efficiency"]
---

# 1.311 Radiated Power and Radiation Resistance

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 533, Page 534, Section 14.2.1

Radiated power is obtained by forming the time-average Poynting vector from the transverse far-zone fields and integrating its radial component over a sphere. Because $E_{\theta s}$ and $H_{\phi s}$ are in phase in the far zone and related by the medium impedance, the radial power density is proportional to $I_0^2k^2d^2\eta\sin^2\theta/r^2$. Multiplication by the spherical area element $r^2\sin\theta\,d\theta\,d\phi$ cancels the radial dependence, so the same net power crosses any sufficiently large sphere in a nonabsorbing medium. In free space, substituting $k=2\pi/\lambda$ and $\eta_0\doteq120\pi$ gives the total average radiated power. Radiation resistance is then defined as the resistance that would dissipate the same average power under sinusoidal current amplitude $I_0$. It is not an ohmic heating resistance, but an input-power representation of radiation. For an electrically tiny element, $R_{\mathrm{rad}}$ scales as $(d/\lambda)^2$ and is very small. This makes efficient radiation and source matching difficult because practical ohmic resistance may be comparable to the radiation resistance while the short antenna's input reactance remains large.

## Page-Grounded Details

#### Page 533

Figure 14.3 The polar plot of the $E$-plane pattern of a vertical current element. The crest amplitude of $E_{\theta s}$ is plotted as a function of the polar angle $\theta$ at a constant distance $r$. The locus is a circle.

is simply the coordinate plane that contains the electric field, which in our present case is any surface of constant $\phi$ in the spherical coordinate system. Figure 14.3 shows an $E$-plane plot of Eq. (22) in polar coordinates, in which the relative magnitude of $E_{\theta s}$ is plotted against $\theta$ for a constant $r$. The length of the vector shown in the figure represents the magnitude of $E_{\theta}$, normalized to unity at $\theta=90^{\circ}$; the vector length is just $|\sin\theta|$, and so as $\theta$ varies, the tip of the vector traces out a circle as shown.

A horizontal, or $H$-plane pattern may also be plotted for this or more complicated antenna systems. In the present case, this would show the variation of field intensity with $\phi$. The $H$-plane of the current element (the plane that contains the magnetic field) is any plane that is normal to the $z$ axis. As $E_{\theta}$ is not a function of $\phi$

[Truncated for analysis]

#### Page 534

Substituting (22) and (23) into (25), we obtain the time-average Poynting vector magnitude:
$$
|< S >|= S_r=\frac{1} {2} \left( \frac{I_0 k d} {4 \pi r} \right)^2 \eta \sin^2 \theta
$$
(26)

From this we find the time-average power that crosses the surface of a sphere of radius $r$, centered at the antenna:
$$
P_r=\int_{\phi=0}^{2\pi} \int_{\theta=0}^{\pi} S_r \ r^2 \sin\theta\ d\theta\ d\phi=2\pi \left( \frac{1} {2} \right) \left( \frac{I_0 k d} {4\pi} \right)^2 \eta \int_0^{\pi} \sin^3 \theta\ d\theta
$$
(27)

The integral is evaluated, and we substitute $k=2\pi/\lambda$. We will also assume that the medium is free space, where $\eta=\eta_0\doteq 120\pi$. We finally obtain:
$$
P_r=40 \pi^2 \left( \frac{I_0 d} {\lambda} \right)^2 \quad\ W
$$
(28)

This is the same average power that would be dissipated in a resistance $R_{\text{rad}}$ by sinusoidal current of amplitude $I_0$ in the absence of any radiation, where
$$
P_r=\frac{1} {2} I_0^2 \ R_{\text{rad}}
$$
(29)

We call this effective resistance the radiation resistance of the antenna. For the differential antenna, this becomes
$$
R_{\text{rad}}=\frac{2 P_r} {I_0^2}=80 \pi^2 \left( \frac{d} {\lambda} \right)^2

[Truncated for analysis]

## Core Ideas

- Radiated power follows from the radial time-average Poynting vector.
- Far-zone power density varies as $1/r^2$ and $\sin^2\theta$.
- Integration over a spherical surface removes dependence on observation radius.
- Free-space radiated power scales as $(I_0d/\lambda)^2$.
- Radiation resistance equates radiated power to resistive power for the same current amplitude.
- Radiation resistance scales as $(d/\lambda)^2$.
- A very short antenna has small radiation resistance.
- Small radiation resistance worsens efficiency and impedance matching when ohmic loss and reactance are significant.

## Source Anchors

- The time-average Poynting vector is
$$
\langle\mathbf{S}\rangle=\frac{1}{2}\operatorname{Re}\{E_{\theta s}H_{\phi s}^*\}\mathbf{a}_r.
$$
- Its magnitude is
$$
S_r=\frac{1}{2}\left(\frac{I_0kd}{4\pi r}\right)^2\eta\sin^2\theta.
$$
- In free space
$$
P_r=40\pi^2\left(\frac{I_0d}{\lambda}\right)^2\ \mathrm{W}.
$$
- Radiation resistance is defined through
$$
P_r=\frac{1}{2}I_0^2R_{\mathrm{rad}}.
$$
- For the differential antenna
$$
R_{\mathrm{rad}}=80\pi^2\left(\frac{d}{\lambda}\right)^2.$$
- For $d=0.01\lambda$, the source gives $R_{\mathrm{rad}}\approx0.08\,\Omega$.

## Related Pages

- [[near-field-and-far-field-behavior|Near-Field and Far-Field Behavior]]
- [[radiation-intensity-and-solid-angle|Radiation Intensity and Solid Angle]]
- [[directivity-and-beamwidth|Directivity and Beamwidth]]
- [[antenna-gain-and-radiation-efficiency|Antenna Gain and Radiation Efficiency]]

## Concept Dependencies

- depends-on: [[radiation-intensity-and-solid-angle|Radiation Intensity and Solid Angle]]
- depends-on: [[antenna-gain-and-radiation-efficiency|Antenna Gain and Radiation Efficiency]]
