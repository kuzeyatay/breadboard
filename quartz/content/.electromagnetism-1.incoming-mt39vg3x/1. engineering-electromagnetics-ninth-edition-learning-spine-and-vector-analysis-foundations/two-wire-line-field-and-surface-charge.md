---
title: "1.84 Two-Wire Line Field and Surface Charge"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 167", "Page 168", "Section 6.4: Capacitance of a Two-Wire Line", "Problem D6.3"]
related: ["cylinder-to-plane-capacitance-by-equivalent-line-charges", "field-sketching-rules-for-two-dimensional-capacitance", "capacitance-as-a-charge-to-potential-ratio"]
---

# 1.84 Two-Wire Line Field and Surface Charge

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 167, Page 168, Section 6.4: Capacitance of a Two-Wire Line, Problem D6.3

Once the potential of the equivalent opposite line charges is known, the electric field is obtained from $\mathbf E=-\nabla V$, and $\mathbf D=\epsilon\mathbf E$. Evaluating the normal component of $\mathbf D$ at a conductor surface gives the local surface charge density. In the cylinder-to-plane example, the surface charge is largest on the side nearest the plane and smallest on the far side. The source calculates $\rho_{S,\max}=0.165$ nC/m$^2$ and $\rho_{S,\min}=0.073$ nC/m$^2$, a ratio of $2.25$. When the cylinder radius is much smaller than its distance from the plane, $b\ll h$, the exact logarithmic expression reduces to
$$
C\approx\frac{2\pi\epsilon L}{\ln(2h/b)}
$$
 The capacitance between two identical circular conductors separated by $2h$ is one-half of the corresponding cylinder-to-plane capacitance. This connects the image-style cylinder-plane solution to the capacitance of a practical two-wire transmission line.

## Page-Grounded Details

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

The electric field intensity can be found by taking the gradient of the potential field, as given by Eq. (11),
$$
\mathbf{E}=-\nabla\left[\frac{\rho_{L}}{4\pi\epsilon}\ln\frac{(x+a)^{2}+y^{2}}{(x-a)^{2}+y^{2}}\right]
$$
Thus,
$$
\mathbf{E}=-\frac{\rho_{L}}{4\pi\epsilon}\left[\frac{2(x+a)\mathbf{a}_{x}+2y\mathbf{a}_{y}}{(x+a)^{2}+y^{2}}-\fr

[Truncated for analysis]

#### Page 168

If we evaluate $D_{x}$ at $x=h-b,y=0$, we may obtain $\rho_{S,\max}$
$$
 \rho_{S,\max}=-D_{x,x=h-b,y=0}=\frac{\rho_{L}}{2\pi}\left[\frac{h-b+a}{(h-b+a)^{2}}-\frac{h-b-a}{(h-b-a)^{2}}\right]
$$
For our example
$$
 \rho_{S,\max}=\frac{3.46\times 10^{-9}}{2\pi}\left[\frac{13-5+12}{(13-5+12)^{2}}-\frac{13-5-12}{(13-5-12)^{2}}\right]=0.165\,nC/m^{2}
$$
Similarly, $\rho_{S,\min}=D_{x,x=h+b,y=0}$, and
$$
 \rho_{S,\min}=\frac{3.46\times 10^{-9}}{2\pi}\left[\frac{13+5+12}{30^{2}}-\frac{13+5-12}{6^{2}}\right]=0.073\,nC/m^{2}
$$
Thus
$$
 \rho_{S,\max}=2.25\rho_{S,\min}
$$
If we apply Eq. (16) to the case of a conductor for which $b\ll h$, then
$$
 \ln\left[(h+\sqrt{h^{2}-b^{2}})/b\right]\doteq\ln\left[(h+h)/b\right]\doteq\ln(2h/b)
$$
and
$$
 C=\frac{2\pi\epsilon L}{\ln(2h/b)}\qquad(b\ll h)\qquad(17) $$
The capacitance between two circular conductors separated by a distance 2h is one-half the capacitance given by Eqs. (16) or (17). This last answer is of interest because it gives us an expression for the capacitance of a section of two-wire transmission line, one of the types of transmission lines studied later in Chapter 13.

D6.3. A conducting cylinder with a radius of 1 cm

[Truncated for analysis]

## Core Ideas

- The field is found by taking the negative gradient of the potential.
- Surface charge density equals the appropriate normal component of $\mathbf D$.
- Charge density is nonuniform around the cylinder.
- The nearest point to the plane has the maximum surface charge density.
- For $b\ll h$, the capacitance denominator becomes $\ln(2h/b)$.
- Two-wire capacitance is one-half of the corresponding cylinder-to-plane value.

## Source Anchors

- Pages 167 and 168 provide explicit rectangular-component formulas for $\mathbf E$ and $\mathbf D$.
- The example gives $\rho_{S,\max}=0.165$ nC/m$^2$.
- The example gives $\rho_{S,\min}=0.073$ nC/m$^2$.
- The calculated ratio is $\rho_{S,\max}=2.25\rho_{S,\min}$.
- Equation (17): $C=2\pi\epsilon L/\ln(2h/b)$ for $b\ll h$.
- Problem D6.3 reports $109.2$ pF/m and $42.6$ nC/m$^2$ for a specified dielectric cylinder-plane geometry.

## Related Pages

- [[cylinder-to-plane-capacitance-by-equivalent-line-charges|Cylinder-to-Plane Capacitance by Equivalent Line Charges]]
- [[field-sketching-rules-for-two-dimensional-capacitance|Field-Sketching Rules for Two-Dimensional Capacitance]]
- [[capacitance-as-a-charge-to-potential-ratio|Capacitance as a Charge-to-Potential Ratio]]

## Concept Dependencies

- depends-on: [[cylinder-to-plane-capacitance-by-equivalent-line-charges|Cylinder-to-Plane Capacitance by Equivalent Line Charges]]
- applies-to: [[capacitance-as-a-charge-to-potential-ratio|Capacitance as a Charge-to-Potential Ratio]]
