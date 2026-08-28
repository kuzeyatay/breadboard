---
title: "1.321 Radiation Intensity, Directivity, and Radiation Resistance"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 545", "Page 546", "Section 14.4.3", "Problem D14.4"]
related: ["dipole-e-plane-pattern-function", "half-wave-dipole-pattern-and-performance", "monopole-antenna-and-image-theory", "effective-area-and-the-transmit-receive-power-ratio"]
---

# 1.321 Radiation Intensity, Directivity, and Radiation Resistance

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 545, Page 546, Section 14.4.3, Problem D14.4

Once the dipole pattern function is known, its principal radiation metrics follow from the far-zone Poynting vector. Since $H_{\phi s}=E_{\theta s}/\eta$, the radiation intensity is $K(\theta)=r^2S_r=(1/2)\operatorname{Re}\{E_{\theta s}H_{\phi s}^*\}r^2$. Substitution of the finite-dipole field gives $K(\theta)=\eta I_0^2[F(\theta)]^2/(8\pi^2)$. In free space, where $\eta_0=120\pi$, this becomes $K(\theta)=15I_0^2[F(\theta)]^2/\pi$ watts per steradian. Total radiated power is obtained by integrating radiation intensity over solid angle. Axial symmetry removes any explicit $\phi$ dependence, leaving $P_r=30I_0^2\int_0^\pi[F(\theta)]^2\sin\theta\,d\theta$. Directivity compares radiation intensity in a chosen direction with the angular average, while radiation resistance is defined so that the radiated power equals the power associated with an equivalent input resistance. Both quantities are therefore governed by the same weighted pattern integral.

## Page-Grounded Details

#### Page 545

Figure 14.8 E-plane plots, normalized to maxima of 1.0, found from $F(\theta)$ for dipole antennas having overall lengths, $2\mathscr{L}$, of (a) $\lambda/16$ (solid black), $\lambda/2$ (dashed), and $\lambda$ (blue), and (b) $1.3\lambda$ (dashed), and $2\lambda$ (blue). In (a), the beam-narrowing trend is evident as length increases (or as wavelength decreases). Note that the $\lambda/16$ curves are nearly circular and thus approximate the Hertzian dipole pattern. At lengths that exceed one wavelength, sidelobes begin to develop, as exhibited in the smaller beams in the $1.3\lambda$ pattern in (b). As length increases, the sidelobes grow to form the four symmetrically arranged main lobes of the $2\lambda$ antenna, where the lobe in the first quadrant maximizes at $\lambda=57.5^{\circ}$. The main lobes along x that were present in the $1.3\lambda$ antenna diminish with increasing length, and have vanished completely when the length reaches $2\lambda$.

sidelobes, develop for overall antenna lengths ($2\mathscr{L}$) that exceed one wavelength. The presence of sidelobes is usually not wanted, mainly because they represent radiated power in directions other

[Truncated for analysis]

#### Page 546

Using this result, expressions for the directivity and radiation resistance can now be found. From Eq. (42), and using (60) and (62), the directivity in free space is
$$
D(\theta)=\frac{4\pi\,K(\theta)}{P_{r}}=\frac{2\left[F(\theta)\right]^{2}}{\int_{0}^{\pi}[F(\theta)]^{2}\,\sin\theta\,d\theta}\quad{(63)}
$$
whose maximum value is
$$
D_{\max}=\frac{2\left[F(\theta)\right]_{\max}^{2}}{\int_{0}^{\pi}[F(\theta)]^{2}\,\sin\theta\,d\theta}\quad{(64)}
$$
Finally, the radiation resistance will be
$$
R_{\mathrm{rad}}=\frac{2P_{r}}{I_{0}^{2}}=60\int_{0}^{\pi}[F(\theta)]^{2}\,\sin\theta\,d\theta\quad{(65)}
$$
D14.4. Evaluate the percentage of the maximum power density that is found in the direction $\theta=45^{\circ}$ for dipole antennas of overall length (a) $\lambda/4$, (b) $\lambda/2$, (c) $\lambda$.

Ans. (a) 45.7%; (b) 38.6%; (c) 3.7%

#### 14.4.4 Half-Wave Dipole

When the antenna length is chosen to be $2\ell=\lambda/2$, we form a "half-wave" dipole; this length choice has several advantages in practice. We begin with an example:

#### EXAMPLE 14.2

Write the specific pattern function, and evaluate the beamwidth, directivity, and radiation resistance of a half-wave di

[Truncated for analysis]

## Core Ideas

- Radiation intensity is $K=r^2S_r$ and has units of watts per steradian.
- The far-zone relation is $H_{\phi s}=E_{\theta s}/\eta$.
- In free space, $K(\theta)=15I_0^2[F(\theta)]^2/\pi$.
- Total radiated power is the integral of $K$ over all solid angles.
- For an axially symmetric dipole, $P_r=30I_0^2\int_0^\pi[F(\theta)]^2\sin\theta\,d\theta$.
- Directivity is $D(\theta)=2[F(\theta)]^2/\int_0^\pi[F(\theta)]^2\sin\theta\,d\theta$.
- Maximum directivity uses the maximum value of $[F(\theta)]^2$.
- Radiation resistance is $R_{\mathrm{rad}}=60\int_0^\pi[F(\theta)]^2\sin\theta\,d\theta$.

## Source Anchors

- Equation (60), Page 545 gives $K(\theta)=\eta I_0^2[F(\theta)]^2/(8\pi^2)=15I_0^2[F(\theta)]^2/\pi$ in free space.
- Equation (61), Page 545 defines total radiated power as an integral over $4\pi$ steradians.
- Equation (62), Page 545 reduces the free-space power to a single integral over $\theta$.
- Equations (63) and (64), Page 546 give directional and maximum directivity.
- Equation (65), Page 546 gives radiation resistance.
- Problem D14.4 reports power-density percentages at $\theta=45^\circ$ of 45.7%, 38.6%, and 3.7% for lengths $\lambda/4$, $\lambda/2$, and $\lambda$.

## Related Pages

- [[dipole-e-plane-pattern-function|Dipole E-Plane Pattern Function]]
- [[half-wave-dipole-pattern-and-performance|Half-Wave Dipole Pattern and Performance]]
- [[monopole-antenna-and-image-theory|Monopole Antenna and Image Theory]]
- [[effective-area-and-the-transmit-receive-power-ratio|Effective Area and the Transmit-Receive Power Ratio]]

