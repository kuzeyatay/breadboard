---
title: "1.313 Directivity and Beamwidth"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 536", "Page 537", "Page 538", "Section 14.2.4", "Problem D14.3"]
related: ["radiation-intensity-and-solid-angle", "hertzian-dipole-radiation-pattern", "antenna-gain-and-radiation-efficiency", "thin-wire-dipole-current-distribution"]
---

# 1.313 Directivity and Beamwidth

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 536, Page 537, Page 538, Section 14.2.4, Problem D14.3

Directivity compares an antenna's radiation intensity in a selected direction with the intensity that an isotropic radiator would produce using the same total radiated power. An isotropic source has constant intensity $K_{\mathrm{iso}}=P_r/(4\pi)$. Therefore the directivity function is $D(\theta,\phi)=4\pi K(\theta,\phi)/P_r$, and maximum directivity uses the largest radiation intensity. Directivity is dimensionless but is commonly expressed in decibels using $10\log_{10}D_{\max}$. Applying the definition to the Hertzian dipole gives $D(\theta,\phi)=\tfrac{3}{2}\sin^2\theta$, so the maximum value is $3/2$ at $\theta=90^\circ$, or $1.76\,\mathrm{dB}$. This modest value reflects the dipole's broad E-plane radiation. The 3 dB beamwidth measures the angular separation between points where directivity falls to half its peak value. For the Hertzian dipole, $\sin^2\theta=1/2$ at $45^\circ$ and $135^\circ$, yielding a $90^\circ$ beamwidth. The source notes that longer antennas narrow the E-plane beam and increase radiation resistance, while narrowing the azimuthally uniform H-plane pattern requires multiple antennas in an array.

## Page-Grounded Details

#### Page 536

Figure 14.4 A cone having differential solid angle $d\Omega$ subtends a (shaded) differential area on the surface of a sphere of radius $r$. This area, given by $dA=r^{2}d\Omega$, can also be expressed in our more familiar spherical coordinate system as $dA=r^{2}\sin\theta\,d\theta\,d\phi$.

The advantage of using the radiation intensity for power density is that this quantity is independent of the radius. This is true, however, only if the original power density exhibits a $1/r^{2}$ dependence. In fact, all antennas have this functional dependence on radius in the far zone, in that when far enough away, the antenna appears as a point source of power. Assuming the surrounding medium does not absorb any power, the integral of the Poynting vector over a closed sphere of any radius must give the same result. This fact demands an inverse-square dependence on radius for the power density. With the radial dependence removed, one can concentrate on the angular dependence of the power density as expressed by $K$, and this will differ significantly among different antennas.

#### 14.2.4 Directivity

A special case of a power source is an isotropic radiator, defined as having a c

[Truncated for analysis]

#### Page 537

The $directivity$ function, $D(\theta,\phi)$, does this. $^{2}$ Using (36) and (37), we can write the directivity:
$$
D(\theta,\phi)=\frac{K(\theta,\phi)}{K_{\rm iso}}=\frac{K(\theta,\phi)}{P_{r}/4\pi}=\frac{4\pi K(\theta,\phi)}{\oint K\,d\Omega}\quad{(38)}
$$
Of particular interest in most cases is the maximum value of the directivity, $D_{\rm max}$, which is sometimes called simply D (without the $\theta$ and $\phi$ dependence indicated):
$$
D=D_{\rm max}=\frac{4\pi K_{\rm max}}{\oint K\,d\Omega}\quad{(39)}
$$
in which the maximum radiation intensity, $K_{\rm max}$, will usually occur at more than one set of values of $\theta$ and $\phi$. Typically, the directivity is quoted in decibels, according to the definition
$$
D_{dB}=10\,\log_{10}(D_{\rm max})\,\,\mathrm{dB}\quad{(40)}
$$
Evaluate the directivity of the Hertzian dipole.

Solution. Use Eqs. (35) and (28) with $k=2\pi/\lambda$ and $\eta=\eta_{0}=120\pi$ in the expression:
$$
D(\theta,\phi)=\frac{4\pi\,K(\theta,\phi)}{P_{r}}=\frac{2\pi\left(\frac{I_{0}d}{2\lambda}\right)^{2}120\pi\,\sin^{2}\theta}{40\,\pi^{2}\left(\frac{I_{0}d}{\lambda}\right)^{2}}=\frac{3}{2}\sin^{2}\theta
$$
The maximum of thi

[Truncated for analysis]

#### Page 538

short antenna) is that power is radiated over a broad angular range in the E plane. In most cases, we wish to confine the power to a narrow range, or small beamwidth, thus increasing the directivity. The 3-dB beamwidth is defined as the separation between the two angles at which the directivity falls to one-half its maximum value. For the Hertzian dipole, and using the $D(\theta,\phi)$ result from the previous example, the beam-width will be the span between the two $\theta$ values on either side of $90^{\circ}$ at which $\sin^{2}$ $\theta=1/2$ , or $|\sin\theta|=1/\sqrt{2}=0.707$ . These two values are $45^{\circ}$ and $135^{\circ}$ , representing a 3-dB beamwidth of $135^{\circ}-45^{\circ}=90^{\circ}$ . We will see that using a longer antenna leads to both a narrower beamwidth and an increased radiation resistance. In the H plane, radiation is uniform at all values of $\phi$ , no matter what length is used. It is necessary to use multiple antennas in an array in order to narrow the beam in the H plane.

#### 14.2.5 Antenna Gain and Radiation Efficiency

We have based several definitions on the total average power that is radiated by the antenna, $P_{r}$ . It

[Truncated for analysis]

## Core Ideas

- An isotropic radiator has $K_{\mathrm{iso}}=P_r/(4\pi)$.
- Directivity compares actual directional intensity with isotropic intensity for equal radiated power.
- Maximum directivity is based on $K_{\max}$.
- Directivity in decibels is $10\log_{10}D_{\max}$.
- The Hertzian dipole has $D(\theta,\phi)=\tfrac{3}{2}\sin^2\theta$.
- Its maximum directivity is $1.5$, or $1.76\,\mathrm{dB}$.
- Its 3 dB E-plane beamwidth is $90^\circ$.
- An antenna array is needed to narrow the H-plane pattern.

## Source Anchors

- The isotropic intensity is
$$
K_{\mathrm{iso}}=\frac{P_r}{4\pi}
$$
- The directivity function is
$$
D(\theta,\phi)=\frac{4\pi K(\theta,\phi)}{\oint K\,d\Omega}
$$
- Maximum directivity is
$$
D_{\max}=\frac{4\pi K_{\max}}{\oint K\,d\Omega}
$$
- The decibel definition is
$$
D_{\mathrm{dB}}=10\log_{10}(D_{\max})
$$
- The worked example obtains
$$
D(\theta,\phi)=\frac{3}{2}\sin^2\theta
$$
$$
D_{\max}=\frac{3}{2}
$$
 and $D_{\mathrm{dB}}=1.76\,\mathrm{dB}$.
- Problem D14.3 gives directivity results for half-space, $\cos^2\theta$, and $|\cos^n\theta|$ power distributions.
- The Hertzian-dipole half-power angles are $45^\circ$ and $135^\circ$.

## Related Pages

- [[radiation-intensity-and-solid-angle|Radiation Intensity and Solid Angle]]
- [[hertzian-dipole-radiation-pattern|Hertzian Dipole Radiation Pattern]]
- [[antenna-gain-and-radiation-efficiency|Antenna Gain and Radiation Efficiency]]
- [[thin-wire-dipole-current-distribution|Thin-Wire Dipole Current Distribution]]

## Concept Dependencies

- related: [[antenna-gain-and-radiation-efficiency|Antenna Gain and Radiation Efficiency]]
