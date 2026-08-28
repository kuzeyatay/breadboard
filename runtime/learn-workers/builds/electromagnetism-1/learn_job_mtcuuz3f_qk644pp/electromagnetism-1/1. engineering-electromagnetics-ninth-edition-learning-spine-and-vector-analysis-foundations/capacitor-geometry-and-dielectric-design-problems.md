---
title: "1.98 Capacitor Geometry and Dielectric Design Problems"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "learning-page"
breadboardType: "learning_page"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
internal: "true"
locations: ["Page 187", "Page 188", "Page 189", "Page 190", "Page 191", "Page 193"]
related: ["potential-to-charge-capacitance-workflow", "cylindrical-one-dimensional-potential-solutions", "spherical-one-dimensional-potential-solutions", "boundary-conditions-and-the-uniqueness-theorem"]
---

# 1.98 Capacitor Geometry and Dielectric Design Problems

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 187, Page 188, Page 189, Page 190, Page 191, Page 193

The chapter problems turn the derived capacitor relations into reusable design procedures. They compare energy storage in coaxial and parallel-plate geometries, examine fixed-voltage and fixed-charge behavior when plate spacing or dielectric filling changes, and optimize dielectric placement. Several tasks treat nonuniform permittivity. A dielectric varying along the field direction can be modeled as differential layers in series, while radial shells that share the same voltage can be treated as differential capacitors in parallel. Other problems divide coaxial or spherical regions into multiple dielectric layers and require field continuity, voltage integration, and capacitance calculation. Breakdown-limited design is represented by comparing the product $CV_{\max}$ using relative permittivity and dielectric breakdown field. The set also includes the relation $RC=\epsilon/\sigma$ for geometrically identical structures filled with homogeneous dielectric or conducting media. These problems collectively teach how geometry, material properties, source connection, and interface orientation determine $\mathbf{E}$, $\mathbf{D}$, charge, stored energy, and capacitance.

## Page-Grounded Details

#### Page 187

5. Collin, R. E., and R. E. Plonsey. Principles and Applications of Electromagnetic Fields. New York: McGraw-Hill, 1961. Provides an excellent treatment of methods of solving Laplace's and Poisson's equations.

6. Smythe, W. R. Static and Dynamic Electricity. 3rd ed. Taylor and Francis, 1989. An advanced treatment of potential theory is given in Chapter 4.

#### CHAPTER 6 PROBLEMS

6.1

Consider a coaxial capacitor having inner radius $a$, outer radius $b$, unit length, and filled with a material with dielectric constant, $\epsilon_{r}$. Compare this to a parallel-plate capacitor having plate width $w$, plate separation $d$, filled with the same dielectric, and having unit length. Express the ratio $b/a$ in terms of the ratio $d/w$, such that the two structures will store the same energy for a given applied voltage.

6.2

Let $S=100 mm^{2}$, $d=3$ mm, and $\epsilon_{r}=12$ for a parallel-plate capacitor. (a) Calculate the capacitance. (b) After connecting a 6-V battery across the capacitor, calculate $E$, $D$, $Q$, and the total stored electrostatic energy. (c) With the source still connected, the dielectric is carefully withdrawn from between the plates.

[Truncated for analysis]

#### Page 188

6.6 A parallel-plate capacitor is made using two circular plates of radius a, with the bottom plate on the xy plane, centered at the origin. The top plate is located at z = d, with its center on the z axis. Charge Q is on the top plate; -Q is on the bottom plate. Dielectric having z-dependent permittivity fills the region between plates. The permittivity is given by $\epsilon(z)=\epsilon_{0}(1+z^{2}/d^{2})$. Find (a) D; (b) E; (c) $V_{0}$; (d) C.

6.7 For the capacitor of Problem 6.6, consider the dielectric as made up of a stack of layers, each having differential thickness dz, and where each layer (at location z) has dielectric constant $\epsilon_{r}=(1+z^{2}/d^{2})$. Evaluate the capacitance by considering the structure as a series combination of the layer capacitances and evaluating an appropriate integral.

6.8 A parallel-plate capacitor is made using two circular plates of radius a, with the bottom plate on the xy plane, centered at the origin. The top plate is located at z = d, with its center on the z axis. Potential $V_{0}$ is on the top plate; the bottom plate is grounded. Dielectric having radially dependent permittivity fills the region between plates. The permi

[Truncated for analysis]

#### Page 189

6.15

A 2-cm-diameter conductor is suspended in air with its axis 5 cm from a conducting plane. Let the potential of the cylinder be 100 V and that of the plane be 0 V. (a) Find the surface charge density on the cylinder at a point nearest the plane. (b) Find the surface charge density on the plane at a point nearest the cylinder. (c) Find the capacitance per unit length.

6.16

Consider an arrangement of two isolated conducting surfaces of any shape that form a capacitor. Use the definitions of capacitance (Eq. (2) in this chapter) and resistance (Eq. (14) in Chapter 5) to show that when the region between the conductors is filled with either conductive material (conductivity $\sigma$) or a perfect dielectric (permittivity $\epsilon$), the resulting resistance and capacitance of the structures are related through the simple formula $RC=\epsilon/\sigma$. What basic properties must be true about both the dielectric and the conducting medium for this condition to hold for certain?

6.17

Construct a curvilinear-square map for a coaxial capacitor of 3 cm inner radius and 8 cm outer radius. These dimensions are suitable for the drawing. (a) Use your sketch to calculate the capaci

[Truncated for analysis]

#### Page 190

Figure 6.13 See Problem 6.21.

6.22 $\hookrightarrow$ A parallel-plate capacitor is air filled and has plate area A and plate separation d. Sufficient dielectric material of relative permittivity $\epsilon_{r}$ is available to fill half the capacitor volume. How should the material be used to maximize the capacitance, and by what factor will the capacitance increase over the air-filled case?

6.23 $\hookrightarrow$ A two-wire transmission line consists of two parallel perfectly conducting cylinders, each having a radius of 0.2 mm, separated by a center-to-center distance of 2 mm. The medium surrounding the wires has $\epsilon_{r}=3$ and $\sigma=1.5$ mS/m. A 100-V battery is connected between the wires. (a) Calculate the magnitude of the charge per meter length on each wire. (b) Using the result of Problem 6.16, find the battery current.

6.24 $\hookrightarrow$ A potential field in free space is given in spherical coordinates as
$$
V(r)=\begin{cases}[\rho_{0}/(6\epsilon_{0})][3a^{2}-r^{2}]&(r\leq a)\\(a^{3}\rho_{0})/(3\epsilon_{0}r)&(r\geq a)\end{cases}
$$
where $\rho_{0}$ and a are constants. (a) Use Poisson's equation to find the volume charge density everywhere. (

[Truncated for analysis]

## Core Ideas

- Fixed-voltage and fixed-charge capacitor changes require different conservation assumptions.
- Dielectric layers stacked along the field act as series capacitances.
- Dielectric regions arranged side by side across equal voltage act as parallel capacitances.
- Spatially varying permittivity requires integrating local field or differential capacitance.
- Breakdown field limits the maximum usable capacitor voltage.
- Composite coaxial and spherical dielectrics require interface matching.
- For matching homogeneous geometries, the source asks students to establish $RC=\epsilon/\sigma$.

## Source Anchors

- Problems 6.1 through 6.5 compare capacitor geometry, energy, plate motion, and partial dielectric filling.
- Problems 6.6 and 6.7 use $\epsilon(z)=\epsilon_0(1+z^2/d^2)$ and a series-layer model.
- Problems 6.8 and 6.9 use $\epsilon(\rho)=\epsilon_0(1+\rho^2/a^2)$ and a parallel-shell model.
- Problem 6.11 divides a coaxial dielectric at $\rho=c$.
- Problem 6.16 asks for a proof of $RC=\epsilon/\sigma$.
- Problem 6.22 asks how to place enough dielectric to fill half the volume so capacitance is maximized.
- Problems 6.31 and 6.43 solve piecewise dielectric boundary-value problems.

## Related Pages

- [[potential-to-charge-capacitance-workflow|Potential-to-Charge Capacitance Workflow]]
- [[cylindrical-one-dimensional-potential-solutions|Cylindrical One-Dimensional Potential Solutions]]
- [[spherical-one-dimensional-potential-solutions|Spherical One-Dimensional Potential Solutions]]
- [[boundary-conditions-and-the-uniqueness-theorem|Boundary Conditions and the Uniqueness Theorem]]

## Concept Dependencies

- applies-to: [[potential-to-charge-capacitance-workflow|Potential-to-Charge Capacitance Workflow]]
- depends-on: [[boundary-conditions-and-the-uniqueness-theorem|Boundary Conditions and the Uniqueness Theorem]]
- applies-to: [[cylindrical-one-dimensional-potential-solutions|Cylindrical One-Dimensional Potential Solutions]]
- applies-to: [[spherical-one-dimensional-potential-solutions|Spherical One-Dimensional Potential Solutions]]
