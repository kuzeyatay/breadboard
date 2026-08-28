---
title: "1.49 Multipoles, Finite Charge Distributions, and Far-Field Limits"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 56", "Page 57", "Page 58", "Page 59", "Section: Chapter 2 Problems"]
related: ["superposition-of-point-charge-electric-fields", "electric-field-integral-for-a-volume-charge-distribution", "off-axis-infinite-line-charge", "parallel-plate-capacitor-field", "streamline-differential-equations"]
---

# 1.49 Multipoles, Finite Charge Distributions, and Far-Field Limits

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 56, Page 57, Page 58, Page 59, Section: Chapter 2 Problems

The chapter problems consolidate the source's methods through point-charge equilibria, dipoles, quadrupoles, finite line charges, rings, disks, annuli, cones, and multiple sheets. These tasks teach a common procedure: define source coordinates, form the source-to-field displacement, exploit symmetry before integrating, choose the correct differential charge element, and simplify the result in a specified region. Several problems explicitly request limits such as $\rho\gg d$ or $z\gg a$. Such limits reveal when an extended neutral or nonuniform source behaves like a dipole, quadrupole, point charge, infinite line, or infinite sheet. Other problems ask for error estimates when replacing a finite line by an infinite one, making approximation quality part of the method. The set also reinforces coordinate conversion, force from $\mathbf{F}=q\mathbf{E}$, charge averaging, and streamline equations in rectangular and cylindrical coordinates.

## Page-Grounded Details

#### Page 56

Therefore,
$$
\ln y=\ln x+C_{1}\qquad\text{or}\qquad\ln y=\ln x+\ln C
$$
)

from which the equations of the streamlines are obtained,
$$
y=Cx
$$
If we want to find the equation of one particular streamline, say one passing through $P(-2,7,10)$, we merely substitute the coordinates of that point into our equation and evaluate C. Here, $7=C(-2)$, and $C=-3.5$, so $y=-3.5x$.

Each streamline is associated with a specific value of C, and the radial lines shown in Figure 2.9$d$ are obtained when $C=0$, 1, $-1$, and $1/C=0$.

The equations of streamlines may also be obtained directly in cylindrical or spheri-cal coordinates. A spherical coordinate example will be examined in Section 4.7.

D2.7. Find the equation of the streamline that passes through the point $P(1$, 4, $-2)$ in the field
$$
E=(a)\frac{-8x}{y}a_{x}+\frac{4x^{2}}{y^{2}}a_{y};(b)\ 2e^{5x}[y(5x+1)a_{x}+xa_{y}]
$$
Ans. $(a)\,x^{2}+2y^{2}=33$; $(b)\,y^{2}=15.7+0.4x-0.08\ln(5x+1)$

#### REFERENCES

1.Boast, W. B. Vector Fields. New York: Harper and Row, 1964. This book contains many examples and sketches of fields.

2.Della Torre, E., and Longo, C. L. The Electromagnetic Field. Boston: Allyn and Bac

[Truncated for analysis]

#### Page 57

2.5

A point charge of 3 nC is located at the point (1,1,1) in free space. What charge must be located at (1,3,2) to cause the y component of E to be zero at the origin?

2.6

Two point charges of equal magnitude $q$ are positioned at $z=\pm d/2$.

(a) Find the electric field everywhere on the z axis; (b) find the electric field everywhere on the xy plane.

2.7

Two point charges of equal magnitude but of opposite sign are positioned with charge $+q$ at $z=+d/2$ and charge $-q$ at $z=-d/2$. The charges in this configuration form an electric dipole. (a) Find the electric field intensity E everywhere on the z axis. (b) Evaluate your part a result at the origin. (c) Find the electric field intensity everywhere on the xy plane, expressing your result as a function of radius $\rho$ in cylindrical coordinates. (d) Evaluate your part c result at the origin. (e) Simplify your part c result for the case in which $\rho>>d$.

2.8

A crude device for measuring charge consists of two small insulating spheres of radius $a$, one of which is fixed in position. The other is movable along the x axis and is subject to a restraining force $kx$, where $k$ is a spring constant. The

[Truncated for analysis]

#### Page 58

2.14 The electron beam in a certain cathode ray tube possesses cylindrical symmetry, and the charge density is represented by $\rho_{v}=-0.1/(\rho^{2}+10^{-8})$ pC/m^3 for $0 < \rho < 3\times10^{-4}m$, and $\rho_{v}=0$ for $\rho>3\times10^{-4}m$. (a) Find the total charge per meter along the length of the beam. (b) If the electron velocity is $5\times10^{7}m/s$, and with one ampere defined as 1 C/s, find the beam current.

2.15 A spherical volume having a 2-$\mu$m radius contains a uniform volume charge density of $10^{5}C/m^{3}$. (a) What total charge is enclosed in the spherical volume? (b) Now assume that a large region contains one of these little spheres at every corner of a cubical grid 3 mm on a side and that there is no charge between the spheres. What is the average volume charge density throughout this large region?

2.16 Within a region of free space, charge density is given as $\rho_{v}=\frac{\rho_{0}r\cos\theta}{a}C/m^{3}$, where $\rho_{0}$ and a are constants. Find the total charge lying within (a) the sphere, $r\leq a$; (b) the cone, $r\leq a$, $0\leq\theta\leq0.1\pi$; (c) the region, $r\leq a$, $0\leq\theta\leq0.1\pi$, $ 0\leq\phi\leq0.2\

[Truncated for analysis]

#### Page 59

2.23  A disk of radius a in the xy plane carries surface charge of density $\rho_{s}=\rho_{s0}/\rho$ C/m^2 where $\rho_{s0}$ is a constant. Find the electric field intensity E everywhere on the z axis.
2.24  (a) Find the electric field on the z axis produced by an annular ring of uniform surface charge density $\rho_{s}$ in free space. The ring occupies the region $z=0,a\leq\rho\leq b,0\leq\phi\leq2\pi$ in cylindrical coordinates. (b) From your part a result, obtain the field of an infinite uniform sheet charge by taking appropriate limits.
2.25  A disk of radius a in the xy plane carries surface charge of density $\rho_{s1}=+\rho_{s0}/\rho$ C/m^2 for $0<\phi<\pi$ , and $\rho_{s2}=-\rho_{s0}/\rho$ C/m^2 for $\pi<\phi<2\pi$ , where $\rho_{s0}$ is a constant. (a) Find the electric field intensity E everywhere on the z axis. (b) Specialize your part a result for distances $z>>a$.
2.26  (a) Find the electric field intensity on the z axis produced by a cone surface that carries charge density $\rho_{s}(r)=\rho_{0}/r$ C/m^2 in free space. The cone has its vertex at the origin and occupies the region $\theta=\alpha,0<r<a$ , and $0<\phi<2\pi$ in spherical coordina

[Truncated for analysis]

## Core Ideas

- Dipole and quadrupole fields arise from structured superpositions of point charges.
- Symmetry identifies components that vanish on axes or symmetry planes.
- Finite distributions require line or surface integration with geometry-specific differentials.
- Far-field limits simplify extended-source fields and expose their leading distance dependence.
- Near-field limits can recover infinite-line or infinite-sheet behavior.
- Approximation error can be quantified by comparing exact finite-source and ideal infinite-source results.
- Force problems use the field produced by one source evaluated at the other source.

## Source Anchors

- Problems 2.1 through 2.11 cover point-charge balance, force, dipoles, quadrupoles, field loci, and coordinate conversion.
- Problems 2.12 through 2.16 cover probabilistic density, spherical shells, electron beams, averaged density, and spherical-coordinate charge integrals.
- Problems 2.17 through 2.21 cover signed finite lines, finite-line approximation error, nonuniform filaments, perpendicular line forces, and a charged circular filament.
- Problems 2.22 through 2.26 cover sheet force, disks, annuli, and a charged cone with point-source and inverse-distance limits.
- Problems 2.27 through 2.30 cover streamline equations, field direction, dipole forces, and cylindrical direction-line equations.
- Problem 2.18 asks for the percentage error from using an infinite-line approximation at $\rho=0.5L$ and $\rho=0.1L$.
- Problem 2.26 asks the cone field to recover a disk at $\alpha=90^\circ$, a point-charge field for $z\gg a$, and inverse-$z$ behavior for $z\ll a$.

## Related Pages

- [[superposition-of-point-charge-electric-fields|Superposition of Point-Charge Electric Fields]]
- [[electric-field-integral-for-a-volume-charge-distribution|Electric Field Integral for a Volume Charge Distribution]]
- [[off-axis-infinite-line-charge|Off-Axis Infinite Line Charge]]
- [[parallel-plate-capacitor-field|Parallel-Plate Capacitor Field]]
- [[streamline-differential-equations|Streamline Differential Equations]]

## Concept Dependencies

- depends-on: [[superposition-of-point-charge-electric-fields|Superposition of Point-Charge Electric Fields]]
- depends-on: [[electric-field-integral-for-a-volume-charge-distribution|Electric Field Integral for a Volume Charge Distribution]]
