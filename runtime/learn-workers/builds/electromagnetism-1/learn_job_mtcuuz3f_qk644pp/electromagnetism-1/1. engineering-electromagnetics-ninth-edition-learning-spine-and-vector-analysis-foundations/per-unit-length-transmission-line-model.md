---
title: "1.163 Per-Unit-Length Transmission-Line Model"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 318", "Page 319", "Section 10.2: The Transmission Line Equations"]
related: ["distributed-versus-lumped-circuit-models", "transmission-line-field-and-circuit-models", "telegraphists-equations", "general-transmission-line-wave-equations"]
---

# 1.163 Per-Unit-Length Transmission-Line Model

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 318, Page 319, Section 10.2: The Transmission Line Equations

A uniform line is represented over a short length $\Delta z$ by four primary constants per unit length: series resistance $R$, series inductance $L$, shunt conductance $G$, and shunt capacitance $C$. The short section therefore contains $R\Delta z$, $L\Delta z$, $G\Delta z$, and $C\Delta z$. Resistance models finite conductor conductivity, while conductance models leakage through an imperfect dielectric. Both dissipate power and can depend on frequency. Inductance and capacitance store magnetic and electric energy. The source divides the series elements equally between the two ends to create a symmetric section, although an equivalent split could be applied to the shunt elements. Voltage and current changes across this section become spatial derivatives in the limit $\Delta z\to0$, allowing ordinary KVL and KCL to generate continuous line equations.

## Page-Grounded Details

#### Page 318

Finally, we surmise that the existence of voltage and current across and within the transmission line conductors implies the existence of electric and magnetic fields in the space around the conductors. Consequently, we have two possible approaches to the analysis of transmission lines: (1) We can solve Maxwell's equations subject to the line configuration to obtain the fields, and with these find general expressions for the wave power, velocity, and other parameters of interest. (2) Or we can (for now) avoid the fields and solve for the voltage and current using an appropriate circuit model. It is the latter approach that we use in this chapter; the contribution of field theory is solely in the prior (and assumed) evaluation of the inductance and capacitance parameters. We will find, however, that circuit models become inconvenient or useless when losses in transmission lines are to be fully characterized, or when analyzing more complicated wave behavior (i.e., moding) which may occur as frequencies get high. The loss issues will be taken up in Section 10.5. Moding phenomena will be considered in Chapter 13.

#### 10.2 THE TRANSMISSION LINE EQUATIONS

Our first goal is to obtain t

[Truncated for analysis]

#### Page 319

Figure 10.3 Lumped-element model of a short transmission line section with losses. The length of the section is $\Delta z$. Analysis involves applying Kirchoff's voltage and current laws (KVL and KCL) to the indicated loop and node, respectively.

First, KVL is applied to the loop that encompasses the entire section length, as shown in Figure 10.3:
$$
\begin{align*}V=&\,\frac{1}{2}RI\Delta z+\frac{1}{2}L\frac{\partial I}{\partial t}\Delta z+\frac{1}{2}L\Big(\frac{\partial I}{\partial t}+\frac{\partial\Delta I}{\partial t}\Big)\Delta z\\ &+\frac{1}{2}R(I+\Delta I)\Delta z+(V+\Delta V)\end{align*}\qquad(1)
$$
We can solve Eq. (1) for the ratio, $\Delta V/\Delta z$, obtaining:
$$
\frac{\Delta V}{\Delta z}=-\Big(RI+L\frac{\partial I}{\partial t}+\frac{1}{2}L\frac{\partial\Delta I}{\partial t}+\frac{1}{2}R\Delta I\Big)\qquad(2)
$$
Next, we write:
$$
\Delta I=\frac{\partial I}{\partial z}\Delta z\qquad{\rm and}\qquad\Delta V=\frac{\partial V}{\partial z}\Delta z\qquad(3)
$$
which are then substituted into (2) to result in
$$
\frac{\partial V}{\partial z}=-\Big(1+\frac{\Delta z}{2}\frac{\partial}{\partial z}\Big)\Big(RI+L\frac{\partial I}{\partial t}\Big)\qquad(4)
$$
Now, in the

[Truncated for analysis]

## Core Ideas

- $R$, $L$, $G$, and $C$ are specified per unit length.
- $R$ models conductor loss and $G$ models dielectric leakage.
- $L$ and $C$ represent distributed magnetic and electric energy storage.
- A section of length $\Delta z$ contains each parameter multiplied by $\Delta z$.
- The infinitesimal-section limit converts circuit differences into spatial derivatives.

## Source Anchors

- Page 318 names $R$, $L$, $G$, and $C$ as the line's primary constants.
- Page 318 relates $G$ to dielectric conductivity and $R$ to conductor conductivity.
- Figure 10.3 on Page 319 shows the symmetric lossy line section of length $\Delta z$.
- Page 318 states that propagation is assumed in the $\mathbf{a}_z$ direction.

## Related Pages

- [[distributed-versus-lumped-circuit-models|Distributed Versus Lumped Circuit Models]]
- [[transmission-line-field-and-circuit-models|Transmission-Line Field and Circuit Models]]
- [[telegraphists-equations|Telegraphist's Equations]]
- [[general-transmission-line-wave-equations|General Transmission-Line Wave Equations]]

## Concept Dependencies

- depends-on: [[distributed-versus-lumped-circuit-models|Distributed Versus Lumped Circuit Models]]
- part-of: [[transmission-line-field-and-circuit-models|Transmission-Line Field and Circuit Models]]
