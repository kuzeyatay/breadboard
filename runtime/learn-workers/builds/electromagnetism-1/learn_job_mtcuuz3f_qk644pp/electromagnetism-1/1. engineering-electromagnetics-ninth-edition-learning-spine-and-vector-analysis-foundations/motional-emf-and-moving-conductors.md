---
title: "1.144 Motional EMF and Moving Conductors"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 295", "Page 296", "Page 297", "Page 298"]
related: ["faraday-induction-flux-linkage-and-lenzs-law", "transformer-emf-and-the-differential-form-of-faradays-law", "magnetic-force-and-torque-on-charges-and-currents"]
---

# 1.144 Motional EMF and Moving Conductors

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 295, Page 296, Page 297, Page 298

Motional emf arises when a conductor or closed path moves through a magnetic field. In the sliding-bar example, a conducting bar moves along two rails in a uniform, time-constant magnetic flux density. If the rail separation is $d$, the bar position is $y$, and its speed is $v=dy/dt$, the enclosed flux is $\Phi=Byd$. Faraday's law gives
$$
\mathrm{emf}=-Bvd
$$
 The same result follows microscopically from the magnetic force per unit charge,
$$
\frac{\mathbf{F}}{Q}=\mathbf{v}\times\mathbf{B}
$$
 which is defined as the motional electric field intensity
$$
\mathbf{E}_m=\mathbf{v}\times\mathbf{B}
$$
 The induced voltage is then
$$
\mathrm{emf}=\oint(\mathbf{v}\times\mathbf{B})\cdot d\mathbf{L}
$$
 When the magnetic field also varies with time, transformer and motional terms are added. The source warns that merely switching from one circuit path to another is not itself motion through a field or explicit field variation. An apparent change in enclosed flux caused only by circuit substitution therefore need not produce an emf.

## Page-Grounded Details

#### Page 295

Figure 9.1 An example illustrating the application of Faraday's law to the case of a constant magnetic flux density $\mathbf{B}$ and a moving path. The shorting bar moves to the right with a velocity $\mathbf{v}$, and the circuit is completed through the two rails and an extremely small high-resistance voltmeter. The voltmeter reading is $V_{12} = -Bvd$.

occasionally cause surprise, however. This particular field is discussed further in Problem 9.19 at the end of the chapter.

#### 9.1.3 Motional EMF

Now consider the case of a time-constant flux and a moving closed path. Before we derive any special results from Faraday's law (1), we use the basic law to analyze the specific problem outlined in Figure 9.1. The closed circuit consists of two parallel conductors which are connected at one end by a high-resistance voltmeter of negligible dimensions and at the other end by a sliding bar moving at a velocity $\mathbf{v}$. The magnetic flux density $\mathbf{B}$ is constant (in space and time) and is normal to the plane containing the closed path.

Let the position of the shorting bar be given by $y$; the flux passing through the surface within the closed path at any time $

[Truncated for analysis]

#### Page 296

and the voltmeter leads. Because we are integrating in a counterclockwise direction (keeping the interior of the positive side of the surface on our left as usual), the contribution $E\,\Delta L$ across the voltmeter must be $-Bvd$, showing that the electric field intensity in the instrument is directed from terminal 2 to terminal 1. For an up-scale reading, the positive terminal of the voltmeter should therefore be terminal 2.

The direction of the resultant small current flow may be confirmed by noting that the enclosed flux is reduced by a clockwise current in accordance with Lenz's law. The voltmeter terminal 2 is again seen to be the positive terminal.

We now consider this example using the concept of motional emf. The force on a charge $Q$ moving at a velocity $\mathbf{v}$ in a magnetic field $\mathbf{B}$ is
$$
\mathbf{F} = Q\mathbf{v} \times \mathbf{B}
$$
or
$$
\frac{\mathbf{F}}{Q} = \mathbf{v} \times \mathbf{B}\quad{(10)}
$$
The sliding conducting bar is composed of positive and negative charges, and each experiences this force. The force per unit charge, as given by (10), is called the motional electric field intensity $\mathbf{E}_{m}$,
$$
\mathbf{E}_{m}

[Truncated for analysis]

#### Page 297

Figure 9.2 An apparent increase in flux linkages does not lead to an induced voltage when one part of a circuit is simply substituted for another by opening the switch. No indication will be observed on the voltmeter.

This expression is equivalent to the simple statement
$$
 \mathrm{emf}=-\frac{d\Phi}{dt}\quad{(1)}
$$
and either can be used to determine these induced voltages.

Although (1) appears simple, there are a few contrived examples in which its proper application is quite difficult. These usually involve sliding contacts or switches; they always involve the substitution of one part of a circuit by a new part.$^{4}$ As an example, consider the simple circuit of Figure 9.2, which contains several perfectly conducting wires, an ideal voltmeter, a uniform constant field **B**, and a switch. When the switch is opened, there is obviously more flux enclosed in the voltmeter circuit; however, it continues to read zero. The change in flux has not been produced by either a time-changing **B** [first term of (14)] or a conductor moving through a magnetic field [second part of (14)]. Instead, a new circuit has been substituted for the old. Thus it is necessary to use care in evalu

[Truncated for analysis]

#### Page 298

at $t=1\,\mu\mathrm{s}$; (c) find the value of the closed line integral of E around the perimeter of the given surface.

Answer. (a) $-20\,000\,\sin 10^{5}t\cos 10^{-3}y\,\mathbf{a}_{z}\,\mathrm{V/m}$; (b) 0.318 mWb; (c) $-3.19\,\mathrm{V}$

D9.2. With reference to the sliding bar shown in Figure 9.1, let $d=7\,\mathrm{cm}$, $\mathbf{B}=0.3\mathbf{a}_{z}\,\mathrm{T}$, and $\mathbf{v}=0.1\mathbf{a}_{v}e^{20y}\,\mathrm{m/s}$. Let $y=0$ at $t=0$. Find: (a) $v(t=0)$; (b) $y(t=0.1)$; (c) $v(t=0.1)$; (d) $V_{12}$ at $t=0.1$.

Answer. (a) 0.1 m/s; (b) 1.12 cm; (c) 0.125 m/s; (d) $-2.63$ mV

#### 9.2 Displacement Current

Faraday's experimental law has been used to obtain one of Maxwell's equations in differential form
$$
 \nabla\times\mathbf{E}=-\frac{\partial\mathbf{B}}{\partial t}\quad{(15)} $$
which shows us that a time-changing magnetic field produces an electric field. Remembering the definition of curl, we see that this electric field has the special property of circulation; its line integral about a general closed path is not zero. Now we turn our attention to the time-changing electric field.

#### 9.2.1 Modifying Ampère's Law for Time-Varying Fields

[Truncated for analysis]

## Core Ideas

- Moving charges in a magnetic field experience force per charge $\mathbf{v}\times\mathbf{B}$.
- The motional electric field is $\mathbf{E}_m=\mathbf{v}\times\mathbf{B}$.
- Motional emf is $\oint(\mathbf{v}\times\mathbf{B})\cdot d\mathbf{L}$.
- For the sliding bar, the enclosed flux is $\Phi=Byd$.
- The sliding-bar voltage is $\mathrm{emf}=-Bvd$.
- Transformer and motional contributions add when both field variation and motion occur.
- Circuit substitution by switching is not equivalent to continuous motion of a conductor through magnetic flux.

## Source Anchors

- S1.P295.F9.1 shows a sliding shorting bar, two rails, a high-resistance voltmeter, uniform $\mathbf{B}$, and velocity $\mathbf{v}$.
- Equation (9) gives $\mathrm{emf}=-Bvd$.
- Equations (10) and (11) define force per charge and $\mathbf{E}_m=\mathbf{v}\times\mathbf{B}$.
- Equation (12) gives $\mathrm{emf}=\oint(\mathbf{v}\times\mathbf{B})\cdot d\mathbf{L}$.
- Equation (14) combines transformer and motional emf.
- S1.P297.F9.2 shows a switched circuit whose apparent flux-linkage increase produces no voltmeter indication because one circuit is substituted for another.
- Drill D9.2 applies the sliding-bar model with $d=7\ \mathrm{cm}$, $\mathbf{B}=0.3\mathbf{a}_z\ \mathrm{T}$, and position-dependent velocity.

## Related Pages

- [[faraday-induction-flux-linkage-and-lenzs-law|Faraday Induction, Flux Linkage, and Lenz's Law]]
- [[transformer-emf-and-the-differential-form-of-faradays-law|Transformer EMF and the Differential Form of Faraday's Law]]
- [[magnetic-force-and-torque-on-charges-and-currents|Magnetic Force and Torque on Charges and Currents]]

## Concept Dependencies

- depends-on: [[magnetic-force-and-torque-on-charges-and-currents|Magnetic Force and Torque on Charges and Currents]]
- contrasts-with: [[transformer-emf-and-the-differential-form-of-faradays-law|Transformer EMF and the Differential Form of Faraday's Law]]
