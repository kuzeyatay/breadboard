---
title: "1.83 Cylinder-to-Plane Capacitance by Equivalent Line Charges"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 164", "Page 165", "Page 166", "Page 167", "Section 6.4: Capacitance of a Two-Wire Line", "Figures 6.4 and 6.5"]
related: ["image-methods-for-conducting-boundaries", "two-wire-line-field-and-surface-charge", "capacitance-as-a-charge-to-potential-ratio"]
---

# 1.83 Cylinder-to-Plane Capacitance by Equivalent Line Charges

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 164, Page 165, Page 166, Page 167, Section 6.4: Capacitance of a Two-Wire Line, Figures 6.4 and 6.5

The cylinder-to-plane problem is solved by recognizing that the equipotential surfaces of two equal and opposite infinite line charges are circular cylinders. With line charges at $x=\pm a$, the combined potential is
$$
V=\frac{\rho_L}{4\pi\epsilon}\ln\frac{(x+a)^2+y^2}{(x-a)^2+y^2}
$$
 Setting $V=V_1$ and defining $K_1=e^{4\pi\epsilon V_1/\rho_L}$ converts the equipotential equation into a circle. Its radius and center are $b=2a\sqrt{K_1}/(K_1-1)$ and $h=a(K_1+1)/(K_1-1)$. Inverting these relations gives $a=\sqrt{h^2-b^2}$ and $\sqrt{K_1}=(h+\sqrt{h^2-b^2})/b$. A conducting cylinder of radius $b$ centered a distance $h$ from a grounded plane therefore has
$$
C=\frac{2\pi\epsilon L}{\cosh^{-1}(h/b)}
$$
 The numerical example with $b=5$ m, $h=13$ m, and $V_0=100$ V obtains $a=12$ m, $K_1=25$, $\rho_L=3.46$ nC/m, and $C=34.6$ pF/m.

## Page-Grounded Details

#### Page 164

If the dielectric boundary were placed normal to the two conducting plates and the dielectrics occupied areas of $S_{1}$ and $S_{2}$, then an assumed potential difference $V_{0}$ would produce field strengths $E_{1}=E_{2}=V_{0}/d$. These are tangential fields at the interface, and they must be equal. Then we may find in succession $D_{1}$, $D_{2}$, $\rho S_{1}$, $\rho S_{2}$, and $Q$, obtaining a capacitance
$$
C = \frac{\epsilon_{1} S_{1} + \epsilon_{2} S_{2}}{d} = C_{1} + C_{2} \quad{(10)}
$$
as we expect.

D6.2. Determine the capacitance of: (a) a 1-ft length of 35B/U coaxial cable, which has an inner conductor 0.1045 in. in diameter, a polyethylene dielectric ($\epsilon_{r} = 2.26$ from Table C.1), and an outer conductor that has an inner diameter of 0.680 in.; (b) a conducting sphere of radius 2.5 mm, covered with a polyethylene layer 2 mm thick, surrounded by a conducting sphere of radius 4.5 mm; (c) two rectangular conducting plates, 1 cm by 4 cm, with negligible thickness, between which are three sheets of dielectric, each 1 cm by 4 cm, and 0.1 mm thick, having dielectric constants of 1.5, 2.5, and 6.

Ans. (a) 20.5 pF; (b) 1.41 pF; (c) 28.7 pF

#### 6

[Truncated for analysis]

#### Page 165

Figure 6.4 Two parallel infinite line charges carrying opposite charge. The positive line is at $x=a,y=0$, and the negative line is at $x=-a,y=0$. A general point $P(x,y,0)$ in the $xy$ plane is radially distant $R_{1}$ and $R_{2}$ from the positive and negative lines, respectively. The equipotential surfaces are circular cylinders.

In order to recognize the equipotential surfaces and adequately understand the problem we are going to solve, some algebraic manipulations are necessary. Choosing an equipotential surface $V=V_{1}$, we define $K_{1}$ as a dimensionless parameter that is a function of the potential $V_{1}$,
$$
K_{1}=e^{4\pi eV_{1}/\rho_{L}}\quad{(12)}
$$
so that
$$
K_{1}=\frac{(x+a)^{2}+y^{2}}{(x-a)^{2}+y^{2}}
$$
After multiplying and collecting like powers, we obtain
$$
x^{2}-2ax\frac{K_{1}+1}{K_{1}-1}+y^{2}+a^{2}=0
$$
We next work through a couple of lines of algebra and complete the square,
$$
(x-a\frac{K_{1}+1}{K_{1}-1})^{2}+y^{2}=\left(\frac{2a\sqrt{K_{1}}}{K_{1}-1}\right)^{2}
$$
This shows that the $V=V_{1}$ equipotential surface is independent of $z$ (or is a cylinder) and intersects the $xy$ plane in a circle of radius $b$,
$$
[Truncated for analysis]

#### Page 166

which is centered at $x = h, y = 0$, where
$$
 h = a \frac{K_1 + 1}{K_1 - 1}
$$
Now consider a zero-potential conducting plane located at $x = 0$, and a conduct-ing cylinder of radius $b$ and potential $V_{0}$ with its axis located a distance $h$ from the plane. We solve the last two equations for $a$ and $K_{1}$ in terms of the dimensions $b$ and $h$
$$
 a = \sqrt{h^{2} - b^{2}}
$$
and
$$
 \sqrt{K_{1}} = \frac{h + \sqrt{h^{2} - b^{2}}}{b}
$$
But the potential of the cylinder is $V_{0}$, so Eq. (12) leads to
$$
 \sqrt{K_{1}} = e^{2\pi\epsilon V_{0}/\rho_{L}}
$$
Therefore
$$
 \rho_{L} = \frac{4\pi\epsilon V_{0}}{\ln K_{1}}
$$
Thus, given $h$, $b$, and $V_{0}$, we may determine $a$, $\rho_{L}$, and the parameter $K_{1}$. The ca-pacitance between the cylinder and plane is now available. For a length $L$ in the $z$ direction, we have
$$
 C = \frac{\rho_{L}L}{V_{0}} = \frac{4\pi\epsilon L}{\ln K_{1}} = \frac{2\pi\epsilon L}{\ln \sqrt{K_{1}}}
$$
or
$$
 C = \frac{2\pi\epsilon L}{\ln [(h + \sqrt{h^{2} - b^{2}})/b]} = \frac{2\pi\epsilon L}{\cosh^{-1}(h/b)}
$$
The solid line in Figure 6.5 shows the cross section of a cylinder of 5 m radius at

[Truncated for analysis]

#### Page 167

Figure 6.5 A numerical example of the capacitance, linear charge density, position of an equivalent line charge, and characteristics of the mid-equipotential surface for a cylindrical conductor of 5 m radius at a potential of 100 V, parallel to and 13 m from a conducting plane at zero potential.

We may also identify the cylinder representing the 50 V equipotential surface by finding new values for $K_{1}$, $h$, and $b$. We first use Eq. (12) to obtain
$$
 K_{1}=e^{4\pi\epsilon V_{1}/\rho_{L}}=e^{4\pi\times8.854\times10^{-12}\times50/3.46\times10^{-9}}=5.00
$$
Then the new radius is
$$
 b=\frac{2a\,\sqrt{K_{1}}}{K_{1}-1}=\frac{2\times 12\,\sqrt{5}}{5-1}=13.42\;\mathrm{m}
$$
and the corresponding value of $h$ becomes
$$
 h=a\,\frac{K_{1}+1}{K_{1}-1}=12\,\frac{5+1}{5-1}=18\;\mathrm{m}
$$
This cylinder is shown in color in Figure 6.5.

The electric field intensity can be found by taking the gradient of the potential field, as given by Eq. (11)
$$
 \mathbf{E}=-\nabla\left[\frac{\rho_{L}}{4\pi\epsilon}\ln\frac{(x+a)^{2}+y^{2}}{(x-a)^{2}+y^{2}}\right]
$$
Thus
$$
 \mathbf{E}=-\frac{\rho_{L}}{4\pi\epsilon}\left[\frac{2(x+a)\mathbf{a}_{x}+2y\mathbf{a}_{y}}{(x+a)^{2}+y^{2}}-\fr

[Truncated for analysis]

## Core Ideas

- Opposite line charges generate circular cylindrical equipotential surfaces.
- The plane $x=0$ is the zero-potential symmetry plane.
- Completing the square identifies each equipotential circle's center and radius.
- The equivalent line-charge position is $a=\sqrt{h^2-b^2}$.
- Cylinder-to-plane capacitance is expressed using $\cosh^{-1}(h/b)$.
- The method replaces a conductor geometry with an equivalent source configuration.

## Source Anchors

- Equation (11) gives the potential of opposite line charges at $x=\pm a$.
- Figure 6.4 labels distances $R_1$ and $R_2$ and shows circular cylindrical equipotentials.
- Equations for the equipotential circle give $b=2a\sqrt{K_1}/(K_1-1)$ and $h=a(K_1+1)/(K_1-1)$.
- The capacitance is $C=2\pi\epsilon L/\cosh^{-1}(h/b)$.
- The worked example obtains $34.6$ pF/m for a 5 m radius cylinder centered 13 m from the plane.
- Visual opportunities S1.P165.F1 and S1.P167.F1: recreate Figures 6.4 and 6.5 with line charges, equipotential cylinders, and adjustable geometry.

## Related Pages

- [[image-methods-for-conducting-boundaries|Image Methods for Conducting Boundaries]]
- [[two-wire-line-field-and-surface-charge|Two-Wire Line Field and Surface Charge]]
- [[capacitance-as-a-charge-to-potential-ratio|Capacitance as a Charge-to-Potential Ratio]]

## Concept Dependencies

- related: [[image-methods-for-conducting-boundaries|Image Methods for Conducting Boundaries]]
- derives-from: [[capacitance-as-a-charge-to-potential-ratio|Capacitance as a Charge-to-Potential Ratio]]
