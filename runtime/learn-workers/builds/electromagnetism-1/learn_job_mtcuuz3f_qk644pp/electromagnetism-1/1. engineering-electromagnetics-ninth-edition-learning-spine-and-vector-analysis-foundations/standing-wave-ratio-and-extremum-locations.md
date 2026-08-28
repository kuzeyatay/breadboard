---
title: "1.249 Standing-Wave Ratio and Extremum Locations"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 428, Section 12.2 and Equation (18)", "Page 429, Equations (19) through (25)", "Page 430, Equation (26), Example 12.2, and Figure 12.3", "Page 431, completion of Example 12.2 and Equation (27)"]
related: ["reflection-and-transmission-coefficients", "total-reflection-from-a-perfect-conductor", "inferring-material-impedance-from-standing-waves", "power-reflectivity-and-conservation"]
---

# 1.249 Standing-Wave Ratio and Extremum Locations

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 428, Section 12.2 and Equation (18), Page 429, Equations (19) through (25), Page 430, Equation (26), Example 12.2, and Figure 12.3, Page 431, completion of Example 12.2 and Equation (27)

When $|\Gamma|<1$, region 1 contains both incident and reflected fields. Their interference creates spatial maxima and minima superimposed on a remaining traveling-wave contribution. Writing $\Gamma=|\Gamma|e^{j\phi}$, the total phasor is
$$
E_{x1T}=E_{x10}^{+}[e^{-j\beta_1z}+|\Gamma|e^{j(\beta_1z+\phi)}]
$$
 The maximum and minimum amplitudes are $(1+|\Gamma|)E_{x10}^{+}$ and $(1-|\Gamma|)E_{x10}^{+}$. Their locations are
$$
z_{\max}=-\frac{\phi+2m\pi}{2\beta_1},\qquad z_{\min}=-\frac{\phi+(2m+1)\pi}{2\beta_1}
$$
 Adjacent maxima, or adjacent minima, are separated by $\lambda_1/2$. The standing-wave ratio is
$$
s=\frac{1+|\Gamma|}{1-|\Gamma|}
$$
 It equals 1 for a matched interface and approaches infinity for total reflection. The phase of $\Gamma$ determines whether the interface itself is a maximum or minimum.

## Page-Grounded Details

#### Page 428

and so we see that the incident and transmitted power densities are related through
$$
\langle S_{2}\rangle=\frac{\mathcal{R}e^{\{1/\eta_{2}^{*}\}}}{\mathcal{R}e^{\{1/\eta_{1}^{*}\}}}|\tau|^{2}\langle S_{1i}\rangle=|\frac{\eta_{1}}{\eta_{2}}|^{2}\left(\frac{\eta_{2}+\eta_{2}^{*}}{\eta_{1}+\eta_{1}^{*}}\right)|\tau|^{2}\langle S_{1i}\rangle
$$
Equation (16) is a relatively complicated way to calculate the transmitted power, unless the impedances are real. It is easier to take advantage of energy conservation by noting that whatever power is not reflected must be transmitted. Eq. (15) can be used to find
$$
\langle S_{2}\rangle=(1-|\Gamma|^{2})\langle S_{1i}\rangle
$$
(17)

As would be expected (and which must be true), Eq. (17) can also be derived from Eq. (16).

D12.1. A 1-MHz uniform plane wave is normally incident onto a fresh water lake ( $\epsilon_{r}^{\prime}=78$, $\epsilon_{r}^{\prime\prime}=0$, $\mu_{r}=1$ ). Determine the fraction of the incident power that is (a) reflected and (b) transmitted. (c) Determine the amplitude of the electric field that is transmitted into the lake.

Ans. (a) 0.63; (b) 0.37; (c) 0.20 V/m

#### 12.2 STANDING WAVE RATIO

In cases where $

[Truncated for analysis]

#### Page 429

will in general be complex. Additionally, if region 2 is a perfect conductor, $\eta_{2}$ is zero, and so $\phi$ is equal to $\pi$ ; if $\eta_{2}$ is real and less than $\eta_{1}$, $\phi$ is also equal to $\pi$ ; and if $\eta_{2}$ is real and greater than $\eta_{1}$, $\phi$ is zero.

Incorporating the phase of $\Gamma$ into (18), the total field in region 1 becomes
$$
E_{x1T}=\left(e^{-j\beta_{1}z}+|\Gamma|e^{j(\beta_{1}z+\phi)}\right) E_{x10}^{+}\qquad(19)
$$
The maximum and minimum field amplitudes in (19) are z-dependent and are subject to measurement. Their ratio, as found for voltage amplitudes in transmission lines (Section 10.10), is the standing wave ratio, denoted by s. We have a maximum when each term in the larger parentheses in (19) has the same phase angle; so, for $E_{x10}^{+}$ positive and real,
$$
\left|E_{x1T}\right|_{\text{max}}=(1+|\Gamma|)E_{x10}^{+}\qquad(20)
$$
and this occurs where
$$
-\beta_{1}z=\beta_{1}z+\phi+2m\pi\qquad(m=0,\pm 1,\pm 2,\ldots)\qquad(21)
$$
Therefore
$$
z_{\text{max}}=-\frac{1}{2\beta_{1}}(\phi+2m\pi)\qquad(22)
$$
Note that an electric field maximum is located at the boundary plane (z = 0) if $\phi=0$ ; mor

[Truncated for analysis]

#### Page 430

Further insights can be obtained by working with Eq. (19) and rewriting it in real instantaneous form. The steps are identical to those taken in Chapter 10, Eqs. (81) through (84). We find the total field in region 1 to be
$$
\mathscr{E}_{x1T}(z,t)=\underbrace{(1-|\Gamma|)E_{x10}^{+}\cos(\omega t-\beta_{1}z)}_{\text{traveling wave}} +2\underbrace{|\Gamma|E_{x10}^{+}\cos(\beta_{1}z+\phi/2)\cos(\omega t+\phi/2)}_{\text{standing wave}}
$$
(26)

The field expressed in Eq. (26) is the sum of a traveling wave of amplitude $(1-|\Gamma|)E_{x10}^{+}$ and a standing wave having amplitude $2|\Gamma|E_{x10}^{+}$. The portion of the incident wave that reflects and back-propagates in region 1 interferes with an equivalent portion of the incident wave to form a standing wave. The rest of the incident wave (that does not interfere) is the traveling wave part of (26). The maximum amplitude observed in region 1 is found where the amplitudes of the two terms in (26) add directly to give $(1+|\Gamma|)E_{x10}^{+}$. The minimum amplitude is found where the standing wave achieves a null, leaving only the traveling wave amplitude of $(1-|\Gamma|)E_{x10}^{+}$. The fact that the two terms in (26)

[Truncated for analysis]

#### Page 431

Solution. We calculate $\omega=6\pi\times 10^{9}$ rad/s, $\beta_{1}=\omega\sqrt{\mu_{1}\epsilon_{1}}=40\pi$ rad/m, and $\beta_{2}=$ $\omega\sqrt{\mu_{2}\epsilon_{2}}=60\pi$ rad/m. Although the wavelength would be 10 cm in air, we find here that $\lambda_{1}=2\pi/\beta_{1}=5$ cm, $\lambda_{2}=2\pi/\beta_{2}=3.33$ cm, $\eta_{1}=60\pi$ $\Omega$, $\eta_{2}=40\pi$ $\Omega$, and $\Gamma=$ ($\eta_{2}-\eta_{1}$)/($\eta_{2}+\eta_{1}$)= - 0.2. Because $\Gamma$ is real and negative ($\eta_{2}<\eta_{1}$), there will be a minimum of the electric field at the boundary, and it will be repeated at half-wavelength (2.5 cm) intervals in dielectric 1. From (23), we see that $|E_{x1T}|_{\text{min}}=80$ V/m.

Maxima of E are found at distances of 1.25, 3.75, 6.25, ... cm from z = 0. These maxima all have amplitudes of 120 V/m, as predicted by (20).

There are no maxima or minima in region 2 because there is no reflected wave there.

The ratio of the maximum to minimum amplitudes is the standing wave ratio:
$$
s=\frac{|E_{x1T}|\max}{|E_{x1T}|\min}=\frac{1+|\Gamma|}{1-|\Gamma|}\quad{(27)}
$$
Because $|\Gamma|<1$, s is always positive and greater than or equal to unity.

[Truncated for analysis]

## Core Ideas

- Partial reflection produces both traveling-wave and standing-wave behavior in region 1.
- The maximum amplitude is $(1+|\Gamma|)E_{x10}^{+}$.
- The minimum amplitude is $(1-|\Gamma|)E_{x10}^{+}$.
- Maxima and minima of the same type repeat every $\lambda_1/2$.
- $\phi=0$ places an electric maximum at the interface.
- $\phi=\pi$ places an electric minimum at the interface.
- $s=(1+|\Gamma|)/(1-|\Gamma|)$.
- $s=1$ indicates no reflection, while $s\to\infty$ indicates total reflection.

## Source Anchors

- Equation (19) gives the total region-1 field including $|\Gamma|$ and phase $\phi$.
- Equations (20) through (25) give the extremum amplitudes and locations.
- Equation (26) decomposes the instantaneous field into traveling and standing contributions.
- Example 12.2 uses $\Gamma=-0.2$ and finds minima of $80\ \mathrm{V/m}$ at half-wavelength intervals.
- Example 12.2 finds maxima of $120\ \mathrm{V/m}$ at 1.25, 3.75, and 6.25 cm from the boundary.
- Equation (27) gives the standing-wave ratio, and D12.2 gives $s=3$ for $\Gamma=\pm1/2$.

## Related Pages

- [[reflection-and-transmission-coefficients|Reflection and Transmission Coefficients]]
- [[total-reflection-from-a-perfect-conductor|Total Reflection from a Perfect Conductor]]
- [[inferring-material-impedance-from-standing-waves|Inferring Material Impedance from Standing Waves]]
- [[power-reflectivity-and-conservation|Power Reflectivity and Conservation]]

## Concept Dependencies

- enables: [[inferring-material-impedance-from-standing-waves|Inferring Material Impedance from Standing Waves]]
