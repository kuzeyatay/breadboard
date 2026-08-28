---
title: "1.129 Flux Linkage and Self-Inductance"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 277", "Page 278", "Page 279", "Page 283", "Section 8.10.1", "Figure 8.14", "Problem D8.12"]
related: ["air-core-toroid-circuit-calculation", "energy-and-vector-potential-definitions-of-inductance", "internal-and-external-inductance", "mutual-inductance-and-reciprocity"]
---

# 1.129 Flux Linkage and Self-Inductance

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 277, Page 278, Page 279, Page 283, Section 8.10.1, Figure 8.14, Problem D8.12

Flux linkage accounts for both the magnetic flux through a coil and the number of turns linked by that flux. If the same total flux $\Phi$ links each of $N$ turns, the total linkage is $N\Phi$. Self-inductance is defined for a linear magnetic system by $L=N\Phi/I$, where current $I$ produces the flux. Its unit is the henry, equivalent to a weber-turn per ampere. For a single-turn coaxial path of length $d$, inner radius $a$, and outer radius $b$, the source uses the known flux to obtain $L=(\mu_0d/2\pi)\ln(b/a)$ and $L'=(\mu_0/2\pi)\ln(b/a)$ H/m. For a closely wound toroid with mean radius $\rho_0$, area $S$, and $N$ turns, $L=\mu_0N^2S/(2\pi\rho_0)$. The $N^2$ dependence arises because one factor of $N$ increases the field-producing ampere-turns and the second counts the turns linked by the resulting flux. If different turns link different amounts of flux, the exact total is $\sum_{i=1}^N\Phi_i$, and winding or pitch factors are used to correct ideal formulas.

## Page-Grounded Details

#### Page 277

We apply a force $F$ over a distance $dL$, thus doing work $F\,dL$. Faraday's law does not apply here, for the fields in the core have not changed, and we can therefore use the principle of virtual work to determine that the work we have done in moving one core appears as stored energy in the air gap we have created. By (48), this increase is
$$
dW_{H}=F\,dL=\frac{1}{2}\frac{B_{\rm st}^{2}}{\mu_{0}}S\,dL
$$
where $S$ is the core cross-sectional area. Thus
$$
F=\frac{B_{\rm st}^{2}S}{2\mu_{0}}
$$
If, for example, the magnetic field intensity is sufficient to produce saturation in the steel, approximately 1.4 T, the force is
$$
F=7.80\times 10^{5}\,S\,\mathrm{~N}
$$
or about 113 $\mathrm{lb}_{f}/\mathrm{in}^{2}$.

D8.11. (a) What force is being exerted on the pole faces of the circuit described in Problem D8.9 and Figure 8.13? (b) Is the force trying to open or close the air gap?

Ans. (a) 1194 N; (b) As Wilhelm Eduard Weber would put it, "schliessen."

#### 8.10 Inductance and Mutual Inductance

Inductance is the last of the three familiar parameters from circuit theory that we are defining in more general terms. Resistance was defined in Chapter 5 as the ratio of th

[Truncated for analysis]

#### Page 278

We now define inductance (or self-inductance) as the ratio of the total flux link-ages to the current which they link,
$$
L = \frac{N\Phi}{I} \quad{(49)}
$$
The current $I$ flowing in the $N$-turn coil produces the total flux $\Phi$ and $N\Phi$ flux linkages, where we assume for the moment that the flux $\Phi$ links each turn. This definition is applicable only to magnetic media which are linear, so that the flux is proportional to the current. If ferromagnetic materials are present, there is no single definition of inductance which is useful in all cases, and we shall restrict our atten-tion to linear materials.

The unit of inductance is the henry (H), equivalent to one weber-turn per ampere.

Let us apply (49) in a straightforward way to calculate the inductance per meter length of a coaxial cable of inner radius $a$ and outer radius $b$. We may take the ex-pression for total flux developed as Eq. (42) in Chapter 7,
$$
\Phi = \frac{\mu_{0}Id}{2\pi}\ln\frac{b}{a}
$$
and obtain the inductance rapidly for a length $d$,
$$
L = \frac{\mu_{0}d}{2\pi}\ln\frac{b}{a}\ H
$$
or, on a per-meter basis,
$$
L = \frac{\mu_{0}}{2\pi}\ln\frac{b}{a}\ H/m \quad{(50)}
$$
In t

[Truncated for analysis]

#### Page 279

Figure 8.14 A portion of a coil showing partial flux linkages. The total flux linkages are obtained by adding the fluxes linking each turn.

flux at the mean radius times the total number of turns. In order to obtain the total flux linkages we must look at the coil on a turn-by-turn basis.
$$
\begin{align*}(N\Phi)_{\text{total}}&=\Phi_{1}+\Phi_{2}+\cdots+\Phi_{i}+\cdots+\Phi_{N}\\ &=\sum_{i=1}^{N}\Phi_{i}\end{align*}
$$
where $\Phi_{i}$ is the flux linking the $i$th turn. Rather than doing this, we usually rely on experience and empirical quantities called winding factors and pitch factors to adjust the basic formula to apply to the real physical world.

#### 8.10.2 Vector Potential and Inductance

An equivalent definition for inductance may be made using an energy point of view,
$$
L=\frac{2W_{H}}{I^{2}}\quad{(52)}
$$
where $I$ is the total current flowing in the closed path and $W_{H}$ is the energy in the magnetic field produced by the current. After using (52) to obtain several other general expressions for inductance, we will show that it is equivalent to (49). We first express the potential energy $W_{H}$ in terms of the magnetic fields,
$$
L=\frac{\int_{\text{

[Truncated for analysis]

#### Page 283

and
$$
 \begin{array}[]{ll}H_{2}=n_{2}I_{2}a_{z}&\quad(0<\rho<R_{2})\\=0&\quad(\rho>R_{2})\end{array}
$$
Thus, for this uniform field
$$
 \Phi_{12}=\mu_{0}n_{1}I_{1}\pi R_{1}^{2}
$$
and
$$
 M_{12}=\mu_{0}n_{1}n_{2}\pi R_{1}^{2}
$$
Similarly
$$
 \begin{array}[]{ll}\Phi_{21}=\mu_{0}n_{2}I_{2}\pi R_{1}^{2}\\ M_{21}=\mu_{0}n_{1}n_{2}\pi R_{1}^{2}=M_{12}\end{array}
$$
If $n_{1}=50$ turns/cm, $n_{2}=80$ turns/cm, $R_{1}=2$ cm, and $R_{2}=3$ cm, then
$$
 M_{12}=M_{21}=4\pi\times 10^{-7}(5000)(8000)\pi(0.02^{2})=63.2~{}\mathrm{mH/m}
$$
The self-inductances are easily found. The flux produced in coil 1 by $I_{1}$ is
$$
 \Phi_{11}=\mu_{0}n_{1}I_{1}\pi R_{1}^{2}
$$
and thus
$$
 L_{1}=\mu_{0}n_{1}^{2}S_{1}d~{}H
$$
The inductance per unit length is therefore
$$
 L_{1}=\mu_{0}n_{1}^{2}S_{1}~{}H/m
$$
or
$$
 L_{1}=39.5~{}\mathrm{mH/m}
$$
Similarly
$$
 L_{2}=\mu_{0}n_{2}^{2}S_{2}=22.7~{}\mathrm{mH/m} $$
We see, therefore, that there are many methods available for the calculation of self-inductance and mutual inductance. Unfortunately, even problems possessing a high degree of symmetry present very challenging integrals for evaluation, and only a few problems are available for

[Truncated for analysis]

## Core Ideas

- Flux linkage is the sum of the flux linking each turn.
- If every turn links the same flux, total linkage is $N\Phi$.
- Self-inductance is $L=N\Phi/I$ for linear media.
- One henry equals one weber-turn per ampere.
- Coaxial-cable inductance depends logarithmically on $b/a$.
- Ideal toroidal-coil inductance is proportional to $N^2S/\rho_0$.
- Partial linkage requires the sum $\sum_i\Phi_i$ rather than a simple product.
- Winding and pitch factors provide empirical corrections for real coils.

## Source Anchors

- Equation (49) defines $L=N\Phi/I$.
- Equation (50) gives coaxial inductance per length as $L'=(\mu_0/2\pi)\ln(b/a)$ H/m for the stated free-space case.
- Equation (51) gives toroidal inductance $L=\mu_0N^2S/(2\pi\rho_0)$.
- Figure S13.P279.F8.14 depicts partial flux linkages in a coil with appreciable turn spacing.
- Page 279 gives $(N\Phi)_{total}=\sum_{i=1}^N\Phi_i$.
- Problem D8.12 applies self-inductance methods to a coaxial cable, toroidal coil, and nonuniform-core solenoid.

## Related Pages

- [[air-core-toroid-circuit-calculation|Air-Core Toroid Circuit Calculation]]
- [[energy-and-vector-potential-definitions-of-inductance|Energy and Vector-Potential Definitions of Inductance]]
- [[internal-and-external-inductance|Internal and External Inductance]]
- [[mutual-inductance-and-reciprocity|Mutual Inductance and Reciprocity]]

## Concept Dependencies

- applies-to: [[air-core-toroid-circuit-calculation|Air-Core Toroid Circuit Calculation]]
