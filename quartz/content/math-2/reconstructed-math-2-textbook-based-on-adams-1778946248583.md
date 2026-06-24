---
title: "Reconstructed Math 2 Textbook Based on Adams"
date: "2026-05-16T15:44:08.583Z"
source: "generated-chat"
knowledge_type: "generated-note"
generated_note_type: "chat-node"
generated_by: "chatmock"
related: []
tags: ["multivariable-calculus", "adams-calculus", "analytic-geometry", "quadric-surfaces", "cylindrical-coordinates", "spherical-coordinates", "vector-valued-functions", "chain-rule"]
---

# Reconstructed Math 2 Textbook Based on Adams

## Overview

This reconstructed textbook reorganizes the Math 2 course around the Adams *Calculus: A Complete Course* structure, while inserting bridge material where the lectures rely on ideas that the official study guide may not explicitly list.

The goal is to make the course flow conceptually:

1. Geometry of space  
2. Surfaces and coordinate systems  
3. Curves and motion  
4. Scalar fields, limits, and continuity  
5. Partial derivatives and the chain rule  
6. Local approximation, gradients, and Taylor formula  
7. Double integrals  
8. Triple integrals and coordinate changes  
9. Vector fields and line integrals  
10. Surface integrals and flux  
11. Gradient, divergence, curl, and synthesis  

Source basis: Adams, *Calculus: A Complete Course*, especially Chapters 10, 12, 13, 15, 16, and 17.

---

# Chapter 1 — The Geometry of Space

**Course week:** Week 1

This chapter combines the official Week 1 material with the vector-algebra material Adams assumes. Even if the study guide officially lists only Sections 10.1, 10.5, and 10.6, the lectures use dot products, cross products, normal vectors, and planes. Therefore, Adams Sections 10.2–10.4 should be inserted here as bridge material.

| Section | Textbook section title | Adams section |
|---:|---|---|
| 1.1 | Points and coordinates in three-dimensional space | 10.1 — Analytic Geometry in Three Dimensions |
| 1.2 | Bridge: vectors, length, distance, and angle | 10.2 — Vectors |
| 1.3 | Bridge: dot product and projections | 10.2 — Vectors |
| 1.4 | Bridge: cross product, orientation, and right-handed systems | 10.3 — The Cross Product in 3-Space |
| 1.5 | Lines and planes in space | 10.4 — Planes and Lines |
| 1.6 | Normal vectors and equations of planes | 10.4 — Planes and Lines |
| 1.7 | Intersections of planes and geometric systems | 10.4 — Planes and Lines |
| 1.8 | Half-spaces, octants, and regions in space | 10.1 — Analytic Geometry in Three Dimensions |
| 1.9 | Open balls, neighborhoods, boundary points, open and closed sets | Bridge to 13.2 — Limits and Continuity |

---

# Chapter 2 — Surfaces and Coordinate Systems

**Course week:** Week 1

This chapter should be separate from Chapter 1 because quadric surfaces and coordinate systems are visually and conceptually important. Adams treats these topics in Chapter 10, and the first lectures already spend significant time on them.

| Section | Textbook section title | Adams section |
|---:|---|---|
| 2.1 | From conic sections to surfaces in space | Bridge from P.3 — Graphs of Quadratic Equations |
| 2.2 | Quadric surfaces as second-degree equations | 10.5 — Quadric Surfaces |
| 2.3 | Spheres and ellipsoids | 10.5 — Quadric Surfaces |
| 2.4 | Circular, elliptic, parabolic, and hyperbolic cylinders | 10.5 — Quadric Surfaces |
| 2.5 | Cones | 10.5 — Quadric Surfaces |
| 2.6 | Elliptic and hyperbolic paraboloids | 10.5 — Quadric Surfaces |
| 2.7 | Hyperboloids of one sheet and two sheets | 10.5 — Quadric Surfaces |
| 2.8 | Recognizing surfaces from equations | 10.5 — Quadric Surfaces |
| 2.9 | Cylindrical coordinates | 10.6 — Cylindrical and Spherical Coordinates |
| 2.10 | Spherical coordinates | 10.6 — Cylindrical and Spherical Coordinates |
| 2.11 | Coordinate surfaces: cylinders, spheres, cones, and half-planes | 10.6 — Cylindrical and Spherical Coordinates |

---

# Chapter 3 — Curves, Parametrizations, and Motion

**Course week:** Week 1

This chapter follows naturally after 3-D geometry, because Adams Chapter 12 treats vector-valued functions of one variable after the 3-D geometry chapter.

| Section | Textbook section title | Adams section |
|---:|---|---|
| 3.1 | Bridge: one-variable derivatives as rates of change | 2.2 — The Derivative |
| 3.2 | Bridge: differentiation rules and chain rule | 2.3 — Differentiation Rules; 2.4 — The Chain Rule |
| 3.3 | Vector functions of one variable | 12.1 — Vector Functions of One Variable |
| 3.4 | Position vectors and parametrized motion | 12.1 — Vector Functions of One Variable |
| 3.5 | Velocity, speed, and acceleration | 12.1 — Vector Functions of One Variable |
| 3.6 | Constant acceleration in vector form | 12.1 — Vector Functions of One Variable |
| 3.7 | Differentiation rules for vector functions | 12.1 — Vector Functions of One Variable |
| 3.8 | Dot-product and cross-product differentiation | 12.1 — Vector Functions of One Variable |
| 3.9 | Constant speed and perpendicular acceleration | 12.1 — Vector Functions of One Variable |
| 3.10 | Curves as parametrized objects | 12.3 — Curves and Parametrizations |
| 3.11 | Reparametrization: same curve, different motion | 12.3 — Curves and Parametrizations |
| 3.12 | Bridge: definite integrals as accumulated length | 5.3 — The Definite Integral; 5.5 — The Fundamental Theorem of Calculus |
| 3.13 | Arc length of parametrized curves | 12.3 — Curves and Parametrizations |
| 3.14 | Curves of intersection of surfaces | 12.3 — Curves and Parametrizations |

---

# Chapter 4 — Scalar Fields, Limits, and Continuity

**Course week:** Week 2

This chapter begins the main multivariable-calculus content. Adams Chapter 13 starts with functions of several variables and then immediately moves to limits and continuity, so these topics should stay together.

| Section | Textbook section title | Adams section |
|---:|---|---|
| 4.1 | Bridge: functions, domains, ranges, and graphs | P.4 — Functions and Their Graphs |
| 4.2 | Functions of two and three variables | 13.1 — Functions of Several Variables |
| 4.3 | Domains in the plane and in space | 13.1 — Functions of Several Variables |
| 4.4 | Graphs of functions of two variables | 13.1 — Functions of Several Variables |
| 4.5 | Level curves | 13.1 — Functions of Several Variables |
| 4.6 | Level surfaces | 13.1 — Functions of Several Variables |
| 4.7 | Scalar fields: temperature, height, density, and potential | 13.1 — Functions of Several Variables |
| 4.8 | Bridge: one-variable limits | 1.2 — Limits of Functions |
| 4.9 | Bridge: one-variable continuity | 1.4 — Continuity |
| 4.10 | Multivariable limits | 13.2 — Limits and Continuity |
| 4.11 | Path dependence and failure of limits | 13.2 — Limits and Continuity |
| 4.12 | Proving multivariable limits exist | 13.2 — Limits and Continuity |
| 4.13 | Continuity of scalar fields | 13.2 — Limits and Continuity |

---

# Chapter 5 — Partial Differentiation and the Chain Rule

**Course week:** Week 3

This chapter combines Adams Sections 13.3–13.5, because these form one natural block: first partial derivatives, higher derivatives, and the multivariable chain rule.

| Section | Textbook section title | Adams section |
|---:|---|---|
| 5.1 | Bridge: ordinary derivatives and partial change | 2.2 — The Derivative; 2.3 — Differentiation Rules |
| 5.2 | First partial derivatives | 13.3 — Partial Derivatives |
| 5.3 | Geometric meaning of partial derivatives | 13.3 — Partial Derivatives |
| 5.4 | Tangent planes | 13.3 — Partial Derivatives |
| 5.5 | Normal lines to surfaces | 13.3 — Partial Derivatives |
| 5.6 | Higher-order partial derivatives | 13.4 — Higher-Order Derivatives |
| 5.7 | Pure and mixed partial derivatives | 13.4 — Higher-Order Derivatives |
| 5.8 | Equality of mixed partial derivatives | 13.4 — Higher-Order Derivatives |
| 5.9 | The multivariable chain rule | 13.5 — The Chain Rule |
| 5.10 | Dependency diagrams and composed variables | 13.5 — The Chain Rule |
| 5.11 | Chain rule along parametrized curves | 13.5 — The Chain Rule; supported by 12.3 — Curves and Parametrizations |
| 5.12 | Chain rule and coordinate changes | 13.5 — The Chain Rule; supported by 10.6 — Cylindrical and Spherical Coordinates |

---

# Chapter 6 — Local Approximation, Gradients, and Taylor Formula

**Course weeks:** Weeks 4–5

This chapter should stay together because Adams Sections 13.6, 13.7, and 13.9 all describe local behavior of scalar fields: linear approximation, directional change, and quadratic approximation.

| Section | Textbook section title | Adams section |
|---:|---|---|
| 6.1 | Bridge: one-variable linear approximation | 4.9 — Linear Approximations |
| 6.2 | Linear approximation in several variables | 13.6 — Linear Approximations, Differentiability, and Differentials |
| 6.3 | Differentiability | 13.6 — Linear Approximations, Differentiability, and Differentials |
| 6.4 | Differentials and small changes | 13.6 — Linear Approximations, Differentiability, and Differentials |
| 6.5 | Directional derivatives | 13.7 — Gradients and Directional Derivatives |
| 6.6 | The gradient vector | 13.7 — Gradients and Directional Derivatives |
| 6.7 | Direction of steepest increase | 13.7 — Gradients and Directional Derivatives |
| 6.8 | Gradients and level curves | 13.7 — Gradients and Directional Derivatives |
| 6.9 | Gradients and level surfaces | 13.7 — Gradients and Directional Derivatives |
| 6.10 | Bridge: one-variable Taylor polynomials | 4.10 — Taylor Polynomials |
| 6.11 | Taylor formula in several variables | 13.9 — Taylor’s Formula, Taylor Series, and Approximations |
| 6.12 | Second-degree Taylor polynomials | 13.9 — Taylor’s Formula, Taylor Series, and Approximations |
| 6.13 | Local quadratic models | 13.9 — Taylor’s Formula, Taylor Series, and Approximations |

## Midterm placement

The midterm naturally belongs after **Section 6.9**, because the study guide says the intermediate test covers material up to and including Week 4.

So the likely midterm boundary is:

> **Chapter 1 through Chapter 6, Section 6.9**

That is, up to gradients and level surfaces, but before the full Taylor-formula material.

---

# Chapter 7 — Double Integrals over Plane Regions

**Course weeks:** Weeks 5–6

This chapter should cover all two-dimensional integration before moving to triple integrals.

| Section | Textbook section title | Adams section |
|---:|---|---|
| 7.1 | Bridge: definite integrals as accumulated quantity | 5.3 — The Definite Integral; 5.4 — Properties of the Definite Integral; 5.5 — The Fundamental Theorem of Calculus |
| 7.2 | From single integrals to double integrals | 15.1 — Double Integrals |
| 7.3 | Double integrals over rectangles | 15.1 — Double Integrals |
| 7.4 | Double integrals over general regions | 15.1 — Double Integrals |
| 7.5 | Meaning of double integrals: volume, mass, charge, accumulated quantity | 15.1 — Double Integrals |
| 7.6 | Iterated integrals in Cartesian coordinates | 15.2 — Iteration of Double Integrals in Cartesian Coordinates |
| 7.7 | Type I and Type II regions | 15.2 — Iteration of Double Integrals in Cartesian Coordinates |
| 7.8 | Reversing the order of integration | 15.2 — Iteration of Double Integrals in Cartesian Coordinates |
| 7.9 | Bridge: polar coordinates revisited | 10.6 — Cylindrical and Spherical Coordinates |
| 7.10 | Double integrals in polar coordinates | 15.4 — Double Integrals in Polar Coordinates |
| 7.11 | Why $dA = r\,dr\,d\theta$ | 15.4 — Double Integrals in Polar Coordinates |
| 7.12 | Choosing Cartesian or polar coordinates | 15.4 — Double Integrals in Polar Coordinates |

---

# Chapter 8 — Triple Integrals, Coordinate Changes, and Surface Area

**Course weeks:** Weeks 6–7

This chapter should not be split too much. Adams Sections 15.5 and 15.6 form a single conceptual block: integration over 3-D solids, then changing coordinates in 3-D. The surface-area part of Section 15.7 fits at the end because it is still an application of multiple integration.

| Section | Textbook section title | Adams section |
|---:|---|---|
| 8.1 | Triple integrals over boxes | 15.5 — Triple Integrals |
| 8.2 | Triple integrals over general solids | 15.5 — Triple Integrals |
| 8.3 | Setting up bounds in $x,y,z$ | 15.5 — Triple Integrals |
| 8.4 | Volumes, masses, and average values | 15.5 — Triple Integrals |
| 8.5 | Bridge: cylindrical coordinates for solids | 10.6 — Cylindrical and Spherical Coordinates |
| 8.6 | Bridge: spherical coordinates for solids | 10.6 — Cylindrical and Spherical Coordinates |
| 8.7 | Change of variables in triple integrals | 15.6 — Change of Variables in Triple Integrals |
| 8.8 | The Jacobian determinant | 15.6 — Change of Variables in Triple Integrals |
| 8.9 | Cylindrical-coordinate integration | 15.6 — Change of Variables in Triple Integrals |
| 8.10 | Spherical-coordinate integration | 15.6 — Change of Variables in Triple Integrals |
| 8.11 | Choosing coordinates from symmetry | 15.6 — Change of Variables in Triple Integrals |
| 8.12 | Surface area of a graph | 15.7 — Applications of Multiple Integrals, only “The surface area of a graph” |

## Note on Adams 15.7

The study guide explicitly restricts Adams Section 15.7 to:

> **The surface area of a graph**

So other applications from Section 15.7 should not be treated as required notebook material unless the instructor adds them separately.

---

# Chapter 9 — Vector Fields, Conservative Fields, and Line Integrals

**Course weeks:** Weeks 7–8

This chapter is where Adams moves from scalar-valued multivariable functions to vector-valued fields. It should include conservative fields before line integrals, because conservative fields explain why some vector line integrals become path independent.

| Section | Textbook section title | Adams section |
|---:|---|---|
| 9.1 | Bridge: scalar fields versus vector fields | 13.1 — Functions of Several Variables; then 16.1 — Vector and Scalar Fields |
| 9.2 | Vector and scalar fields | 16.1 — Vector and Scalar Fields |
| 9.3 | Field lines, trajectories, and streamlines | 16.1 — Vector and Scalar Fields |
| 9.4 | Physical examples: velocity, force, electric, and magnetic fields | 16.1 — Vector and Scalar Fields |
| 9.5 | Conservative fields | 16.2 — Conservative Fields |
| 9.6 | Potential functions | 16.2 — Conservative Fields |
| 9.7 | Equipotential curves and surfaces | 16.2 — Conservative Fields |
| 9.8 | Bridge: integrating along a parametrized curve | 12.3 — Curves and Parametrizations |
| 9.9 | Scalar line integrals | 16.3 — Line Integrals |
| 9.10 | Vector line integrals | 16.4 — Line Integrals of Vector Fields |
| 9.11 | Work done by a force field | 16.4 — Line Integrals of Vector Fields |
| 9.12 | Orientation of curves | 16.4 — Line Integrals of Vector Fields |
| 9.13 | Path independence and conservative fields | 16.4 — Line Integrals of Vector Fields; linked to 16.2 — Conservative Fields |

## Excluded topic

The study guide excludes the **Lyapunov functions** part of Adams Section 16.1. Therefore, Lyapunov functions should not be part of the required notebook.

---

# Chapter 10 — Surface Integrals and Flux

**Course week:** Week 8

This deserves its own chapter. Surface integrals are not just “triple integrals on surfaces”; they introduce parametrized surfaces, normal vectors, orientation, and flux.

| Section | Textbook section title | Adams section |
|---:|---|---|
| 10.1 | Bridge: parametrized surfaces as two-parameter objects | 16.5 — Surfaces and Surface Integrals |
| 10.2 | Tangent vectors to a surface | 16.5 — Surfaces and Surface Integrals |
| 10.3 | Surface normals from cross products | 16.5 — Surfaces and Surface Integrals |
| 10.4 | Surface area element $dS$ | 16.5 — Surfaces and Surface Integrals |
| 10.5 | Scalar surface integrals | 16.5 — Surfaces and Surface Integrals |
| 10.6 | Evaluating surface integrals | 16.5 — Surfaces and Surface Integrals |
| 10.7 | Oriented surfaces | 16.6 — Oriented Surfaces and Flux Integrals |
| 10.8 | Choosing a normal direction | 16.6 — Oriented Surfaces and Flux Integrals |
| 10.9 | Flux integrals | 16.6 — Oriented Surfaces and Flux Integrals |
| 10.10 | Physical meaning of flux | 16.6 — Oriented Surfaces and Flux Integrals |

---

# Chapter 11 — Gradient, Divergence, Curl, and Course Synthesis

**Course weeks:** Weeks 8–9

This should be the final chapter. Adams Section 17.1 is officially included. Later sections such as Green’s Theorem, the Divergence Theorem, and Stokes’s Theorem are not in the study guide. However, because Adams’s own front formula pages list them as versions of the Fundamental Theorem of Calculus, they are useful as conceptual orientation, not examinable core.

| Section | Textbook section title | Adams section |
|---:|---|---|
| 11.1 | Bridge: what line integrals and surface integrals measure globally | 16.3 — Line Integrals; 16.4 — Line Integrals of Vector Fields; 16.6 — Oriented Surfaces and Flux Integrals |
| 11.2 | The nabla operator $\nabla$ | 17.1 — Gradient, Divergence, and Curl |
| 11.3 | Gradient as spatial change | 17.1 — Gradient, Divergence, and Curl; linked to 13.7 — Gradients and Directional Derivatives |
| 11.4 | Divergence as local source strength | 17.1 — Gradient, Divergence, and Curl |
| 11.5 | Curl as local rotation | 17.1 — Gradient, Divergence, and Curl |
| 11.6 | Computing gradient, divergence, and curl | 17.1 — Gradient, Divergence, and Curl |
| 11.7 | Physical interpretation in vector fields | 17.1 — Gradient, Divergence, and Curl |
| 11.8 | Connecting gradient, conservative fields, line integrals, divergence, flux, and curl | Synthesis of 16.1–16.6 and 17.1 |
| 11.9 | Optional conceptual preview: Green, Divergence, and Stokes Theorems | 17.3 — Green’s Theorem in the Plane; 17.4 — The Divergence Theorem in 3-Space; 17.5 — Stokes’s Theorem |
| 11.10 | Final exam problem classification | All assigned sections |

## Excluded topic

The official final-test list includes:

> 17.1 — Gradient, Divergence, and Curl

but excludes:

> Distributions and delta functions

Therefore, distributions and delta functions should not be included as required material.

---

# Final Master Map

| Chapter | Textbook title | Main Adams sections | Course week |
|---:|---|---|---|
| 1 | The Geometry of Space | 10.1 — Analytic Geometry in Three Dimensions; bridges from 10.2 — Vectors, 10.3 — The Cross Product in 3-Space, 10.4 — Planes and Lines | Week 1 |
| 2 | Surfaces and Coordinate Systems | 10.5 — Quadric Surfaces; 10.6 — Cylindrical and Spherical Coordinates | Week 1 |
| 3 | Curves, Parametrizations, and Motion | 12.1 — Vector Functions of One Variable; 12.3 — Curves and Parametrizations | Week 1 |
| 4 | Scalar Fields, Limits, and Continuity | 13.1 — Functions of Several Variables; 13.2 — Limits and Continuity | Week 2 |
| 5 | Partial Differentiation and the Chain Rule | 13.3 — Partial Derivatives; 13.4 — Higher-Order Derivatives; 13.5 — The Chain Rule | Week 3 |
| 6 | Local Approximation, Gradients, and Taylor Formula | 13.6 — Linear Approximations, Differentiability, and Differentials; 13.7 — Gradients and Directional Derivatives; 13.9 — Taylor’s Formula, Taylor Series, and Approximations | Weeks 4–5 |
| 7 | Double Integrals over Plane Regions | 15.1 — Double Integrals; 15.2 — Iteration of Double Integrals in Cartesian Coordinates; 15.4 — Double Integrals in Polar Coordinates | Weeks 5–6 |
| 8 | Triple Integrals, Coordinate Changes, and Surface Area | 15.5 — Triple Integrals; 15.6 — Change of Variables in Triple Integrals; 15.7 — Applications of Multiple Integrals, only surface area of a graph | Weeks 6–7 |
| 9 | Vector Fields, Conservative Fields, and Line Integrals | 16.1 — Vector and Scalar Fields; 16.2 — Conservative Fields; 16.3 — Line Integrals; 16.4 — Line Integrals of Vector Fields | Weeks 7–8 |
| 10 | Surface Integrals and Flux | 16.5 — Surfaces and Surface Integrals; 16.6 — Oriented Surfaces and Flux Integrals | Week 8 |
| 11 | Gradient, Divergence, Curl, and Course Synthesis | 17.1 — Gradient, Divergence, and Curl, excluding distributions/delta functions | Weeks 8–9 |

---

# Assessment Boundaries

## Intermediate test / midterm

Likely coverage:

| Assessment | Likely coverage |
|---|---|
| Midterm | Chapter 1 through Chapter 6, Section 6.9 |

That means the midterm likely includes:

- 3-D geometry  
- vectors, dot products, cross products  
- planes and lines  
- quadric surfaces  
- cylindrical and spherical coordinates  
- vector functions and parametrized curves  
- scalar fields  
- multivariable limits and continuity  
- partial derivatives  
- tangent planes and normal lines  
- higher-order partials  
- chain rule  
- linear approximation and differentials  
- gradients and directional derivatives  
- gradients with level curves and level surfaces  

It likely stops before the full multivariable Taylor-formula section.

## Final test

Likely coverage:

| Assessment | Likely coverage |
|---|---|
| Final | All assigned sections, with emphasis on post-midterm material |

The final should include everything assigned, especially:

- Taylor formula in several variables  
- double integrals  
- polar integration  
- triple integrals  
- cylindrical and spherical integration  
- Jacobians and coordinate changes  
- surface area of a graph  
- vector fields  
- conservative fields  
- line integrals  
- surface integrals  
- flux  
- gradient, divergence, and curl  

Optional conceptual orientation:

- Green’s Theorem  
- Divergence Theorem  
- Stokes’s Theorem  

But these are not listed as required core material unless the instructor explicitly adds them.