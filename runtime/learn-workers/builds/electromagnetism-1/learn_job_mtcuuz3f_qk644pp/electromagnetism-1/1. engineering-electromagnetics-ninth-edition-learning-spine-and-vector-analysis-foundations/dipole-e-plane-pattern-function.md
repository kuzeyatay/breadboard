---
title: "1.320 Dipole E-Plane Pattern Function"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 544", "Page 545", "Section 14.4.3", "Figure 14.8"]
related: ["parity-based-evaluation-of-the-dipole-field-integral", "radiation-intensity-directivity-and-radiation-resistance", "half-wave-dipole-pattern-and-performance", "pattern-multiplication-for-antenna-arrays"]
---

# 1.320 Dipole E-Plane Pattern Function

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 544, Page 545, Section 14.4.3, Figure 14.8

The angular dependence of a finite dipole is isolated in the pattern function $F(\theta)=[\cos(k\ell\cos\theta)-\cos(k\ell)]/\sin\theta$. When normalized to its maximum magnitude, this function gives the dipole's E-plane field pattern. Because a single straight dipole is rotationally symmetric about the $z$ axis, any plane containing that axis has the same pattern. The pattern changes systematically with overall length $2\ell$. Very short dipoles produce a nearly circular E-plane polar curve corresponding to the familiar Hertzian-dipole behavior. Increasing the length initially narrows the main beam, improving angular concentration. Once the overall length exceeds approximately one wavelength, secondary maxima or sidelobes develop. These sidelobes divert power away from the intended main-beam direction and their directions vary with wavelength. A broadband signal can consequently acquire an angular spread because its different frequency components have different sidelobe directions. The source therefore identifies lengths below one wavelength as a practical way to avoid these effects while retaining a single dominant broadside lobe.

## Page-Grounded Details

#### Page 544

integral as A, we write:
$$
E_{\theta s}(r, \theta)=A \int_{-\ell}^{\ell} \frac{\sin k(\ell - |z|)}{\text{even}} \underbrace{\cos(kz \cos \theta)}_{\text{even}}+j \frac{\sin k(\ell - |z|)}{\text{even}} \underbrace{\frac{\sin(kz \cos \theta)}{\text{odd}}} dz
$$
in which the even or odd parity of each term is indicated. The imaginary part of the integrand, consisting of the product of even and odd functions, yields a term with net odd parity; it thus integrates to zero over the symmetric limits of $-\ell$ to $\ell$. This leaves the real part, whose integral can be expressed over the positive $z$ range and then further simplified using trigonometric identities:
$$
\begin{align*}E_{\theta s}(r, \theta)&=2A \int_{0}^{\ell} \sin k(\ell - z) \cos(kz \cos \theta) dz\\&=A \int_{0}^{\ell} \sin [k(\ell - z) + kz \cos \theta] + \sin [k(\ell - z) - kz \cos \theta]dz\\&=A \int_{0}^{\ell} \sin [kz(\cos \theta - 1) + k\ell] - \sin [kz(\cos \theta + 1) - k\ell]dz\end{align*}
$$
The last integral is straightforward and evaluates as
$$
E_{\theta s}(r, \theta)=2A \left[ \frac{\cos(k\ell \cos \theta) - \cos(k\ell)}{k \sin^2 \theta} \right]
$$
Now, reincorporating the expression for A gives

[Truncated for analysis]

#### Page 545

Figure 14.8 E-plane plots, normalized to maxima of 1.0, found from $F(\theta)$ for dipole antennas having overall lengths, $2\mathscr{L}$, of (a) $\lambda/16$ (solid black), $\lambda/2$ (dashed), and $\lambda$ (blue), and (b) $1.3\lambda$ (dashed), and $2\lambda$ (blue). In (a), the beam-narrowing trend is evident as length increases (or as wavelength decreases). Note that the $\lambda/16$ curves are nearly circular and thus approximate the Hertzian dipole pattern. At lengths that exceed one wavelength, sidelobes begin to develop, as exhibited in the smaller beams in the $1.3\lambda$ pattern in (b). As length increases, the sidelobes grow to form the four symmetrically arranged main lobes of the $2\lambda$ antenna, where the lobe in the first quadrant maximizes at $\lambda=57.5^{\circ}$. The main lobes along x that were present in the $1.3\lambda$ antenna diminish with increasing length, and have vanished completely when the length reaches $2\lambda$.

sidelobes, develop for overall antenna lengths ($2\mathscr{L}$) that exceed one wavelength. The presence of sidelobes is usually not wanted, mainly because they represent radiated power in directions other

[Truncated for analysis]

## Core Ideas

- The dipole pattern function is $F(\theta)=[\cos(k\ell\cos\theta)-\cos(k\ell)]/\sin\theta$.
- The normalized magnitude of $F(\theta)$ is the E-plane field pattern.
- All planes containing the dipole axis have the same pattern.
- Very short dipoles approximate the Hertzian-dipole pattern.
- Increasing dipole length initially narrows the main beam.
- Overall lengths greater than one wavelength develop sidelobes.
- Sidelobes send power away from the intended direction and move with wavelength.
- Using a length below one wavelength avoids the cited sidelobe and angular-spread problems.

## Source Anchors

- Equation (59), Page 544 defines $F(\theta)=[\cos(k\ell\cos\theta)-\cos(k\ell)]/\sin\theta$.
- Figure S26.P545.F14.8 compares normalized E-plane patterns for overall lengths $\lambda/16$, $\lambda/2$, $\lambda$, $1.3\lambda$, and $2\lambda$.
- The $\lambda/16$ curve is described as nearly circular and approximating the Hertzian-dipole pattern.
- The source reports sidelobe development for overall lengths exceeding one wavelength.
- For the $2\lambda$ antenna, Figure 14.8 shows four symmetrically arranged main lobes, with the first-quadrant lobe at approximately $57.5^\circ$.
- Page 545 explains that wavelength-dependent sidelobe directions can produce angular spread in broadband signals.

## Related Pages

- [[parity-based-evaluation-of-the-dipole-field-integral|Parity-Based Evaluation of the Dipole Field Integral]]
- [[radiation-intensity-directivity-and-radiation-resistance|Radiation Intensity, Directivity, and Radiation Resistance]]
- [[half-wave-dipole-pattern-and-performance|Half-Wave Dipole Pattern and Performance]]
- [[pattern-multiplication-for-antenna-arrays|Pattern Multiplication for Antenna Arrays]]

## Concept Dependencies

- enables: [[radiation-intensity-directivity-and-radiation-resistance|Radiation Intensity, Directivity, and Radiation Resistance]]
