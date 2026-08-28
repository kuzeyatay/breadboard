---
title: "1.128 Magnetic Field Energy and Air-Gap Force"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 275", "Page 276", "Page 277", "Section 8.9", "Problem D8.11"]
related: ["nonlinear-gapped-magnetic-circuit-analysis", "energy-and-vector-potential-definitions-of-inductance", "flux-linkage-and-self-inductance"]
---

# 1.128 Magnetic Field Energy and Air-Gap Force

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 275, Page 276, Page 277, Section 8.9, Problem D8.11

For a steady magnetic field in a linear medium, the stored energy is $W_H=(1/2)\int_{vol}\mathbf{B}\cdot\mathbf{H}\,dv$. If $\mathbf{B}=\mu\mathbf{H}$, equivalent forms are $W_H=(1/2)\int_{vol}\mu H^2\,dv$ and $W_H=(1/2)\int_{vol}B^2/\mu\,dv$. The associated energy density is treated as $w_H=(1/2)\mathbf{B}\cdot\mathbf{H}$ J/m$^3$. The source cautions that a direct mechanical derivation using moving current sheets is incomplete because Faraday induction transfers part of the work to the current source. Nevertheless, the linear energy formulas can calculate forces on nonlinear magnetic materials by focusing on the surrounding linear air. If two steel core sections are separated by a differential distance while flux density remains constant, the mechanical work $F\,dL$ equals the increase in air-gap energy. For core area $S$, this gives $F=B_{st}^2S/(2\mu_0)$. At a saturated steel flux density of about 1.4 T, the pressure is approximately $7.80\times10^5$ N/m$^2$, or 113 lbf/in$^2$.

## Page-Grounded Details

#### Page 275

Figure 8.13 See Problem D8.9.

D8.9. Given the magnetic circuit of Figure 8.13, assume $B=0.6\$T at the mid-point of the left leg and find: (a) $V_{m,\text{air}}$; (b) $V_{m,\text{steel}}$; (c) the current required in a 1300-turn coil linking the left leg.

Ans. (a) 3980 A*t; (b) 72 A*t; (c) 3.12 A

D8.10. The magnetization curve for material X under normal operating conditions may be approximated by the expression $B=(H/160)(0.25+e^{-H/320})$, where H is in A/m and B is in T. If a magnetic circuit contains a 12 cm length of material X, as well as a 0.25-mm air gap, assume a uniform cross section of 2.5 $\mathrm{cm}^{2}$ and find the total mmf required to produce a flux of (a) 10 $\mu$Wb; (b) 100 $\mu$Wb.

Ans. (a) 8.58 A*t; (b) 86.7 A*t

#### 8.9 POTENTIAL ENERGY AND FORCES ON MAGNETIC MATERIALS

In the electrostatic field we first introduced the point charge and the experimental law of force between point charges. After defining electric field intensity, electric flux density, and electric potential, we were able to find an expression for the energy in an electrostatic field by establishing the work necessary to bring the prerequisite point charges from infinity to

[Truncated for analysis]

#### Page 276

due to the other, move the sheet a differential distance against this force, and equate the necessary work to the change in energy. If we did, we would be wrong, because Faraday's law (coming up in Chapter 9) shows that there will be a voltage induced in the moving current sheet against which the current must be maintained. Whatever source is supplying the current sheet turns out to receive half the energy we are putting into the circuit by moving it.

In other words, energy density in the magnetic field may be determined more easily after time-varying fields are discussed. We will develop the appropriate expression in discussing Poynting's theorem in Chapter 11.

An alternate approach would be possible at this time, however, for we might define a magnetostatic field based on assumed magnetic poles (or "magnetic charges"). Using the scalar magnetic potential, we could then develop an energy expression by methods similar to those used in obtaining the electrostatic energy relationship. These new magnetostatic quantities we would have to introduce would be too great a price to pay for one simple result, and we will therefore merely present the result at this time and show that the sa

[Truncated for analysis]

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

## Core Ideas

- Linear magnetic energy is $W_H=(1/2)\int\mathbf{B}\cdot\mathbf{H}\,dv$.
- For $\mathbf{B}=\mu\mathbf{H}$, energy may be written using either $H^2$ or $B^2$.
- Magnetic energy density is $w_H=(1/2)\mathbf{B}\cdot\mathbf{H}$.
- A naive moving-current-sheet derivation omits energy exchanged with the current source.
- Virtual work can evaluate forces by tracking energy added to a linear air gap.
- At constant flux density, gap force is $F=B^2S/(2\mu_0)$.
- The force acts to reduce the air gap.

## Source Anchors

- Equation (46) gives $W_H=(1/2)\int_{vol}\mathbf{B}\cdot\mathbf{H}\,dv$.
- Equations (47) and (48) give the equivalent $\mu H^2$ and $B^2/\mu$ forms.
- Pages 275 and 276 explain why Faraday induction complicates a direct mechanical derivation.
- Page 277 equates $F\,dL$ to $(1/2)(B_{st}^2/\mu_0)S\,dL$.
- The resulting force formula is $F=B_{st}^2S/(2\mu_0)$.
- For $B_{st}\approx1.4$ T, the source gives $F=7.80\times10^5S$ N.
- Problem D8.11 reports a 1194 N force that tends to close the air gap.

## Related Pages

- [[nonlinear-gapped-magnetic-circuit-analysis|Nonlinear Gapped Magnetic Circuit Analysis]]
- [[energy-and-vector-potential-definitions-of-inductance|Energy and Vector-Potential Definitions of Inductance]]
- [[flux-linkage-and-self-inductance|Flux Linkage and Self-Inductance]]

## Concept Dependencies

- applies-to: [[nonlinear-gapped-magnetic-circuit-analysis|Nonlinear Gapped Magnetic Circuit Analysis]]
