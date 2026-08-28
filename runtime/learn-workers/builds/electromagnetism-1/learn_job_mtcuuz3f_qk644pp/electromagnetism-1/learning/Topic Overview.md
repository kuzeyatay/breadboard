---
title: "Topic Overview"
date: "2026-08-28T11:18:19.690Z"
knowledge_type: "topic-overview"
breadboardType: "topic_overview"
gardenId: "electromagnetism-1"
generatedBy: "learn_button"
generated_by: "learn_button"
learningVersion: "learning_mtcuvtlj_g4lngtf"
learningVersionId: "learning_mtcuvtlj_g4lngtf"
sourceSetHash: "e74b24e8f469898e94710a637ffa89d94be169b66171409ce80f27f2cb1a2e54"
---

# Electromagnetic Fields and Waves

Electromagnetism studies how charge and current establish fields in space, how those fields exert forces and store energy, how materials reshape them, and how changing electric and magnetic fields propagate as waves. The subject is spatial from the beginning. A field assigns a magnitude and direction to each position, so vectors, coordinate systems, and calculus are part of the physical model.

The central learning path begins with geometry. Vectors describe field direction and magnitude, while Cartesian, cylindrical, and spherical coordinates adapt that description to different symmetries. Coulomb's law then connects charge to electric field. Superposition extends one source to many sources and continuous charge distributions.

Flux and circulation provide the next step. Electric flux measures how much field crosses a surface, and Gauss's law connects net outward flux to enclosed charge. Divergence turns this surface statement into a local statement about charge density. Electric potential describes the work associated with moving charge, and its gradient recovers the electric field. Energy density, current density, charge conservation, polarization, permittivity, boundary conditions, and capacitance then connect field laws to materials and conductor geometries.

The magnetic sequence follows the same pattern with different geometry. Current elements generate magnetic fields through the Biot-Savart law. Ampere's law uses symmetry and circulation to simplify selected current systems. Curl measures circulation locally, while Stokes' theorem connects local curl across a surface to circulation around its boundary. Magnetic potentials, Lorentz force, magnetization, flux linkage, stored magnetic energy, and inductance extend this framework to particles, materials, and coils.

Maxwell's equations bring the electric and magnetic descriptions together. Changing magnetic flux produces electric-field circulation, while conduction current and changing electric flux produce magnetic-field circulation. In free space, these coupled changes satisfy wave equations. Phasors then provide a frequency-domain description, the Helmholtz equation describes spatial wave behavior, and intrinsic impedance fixes the electric-to-magnetic field ratio.

Throughout the garden, keep the main field quantities distinct. Electric field intensity $\mathbf{E}$ describes electric force per unit charge, while electric flux density $\mathbf{D}$ connects electric behavior to free charge and material response. Magnetic field intensity $\mathbf{H}$ connects magnetic circulation to current, while magnetic flux density $\mathbf{B}$ determines magnetic flux and magnetic force. Constitutive relations connect each field-intensity quantity to its corresponding flux-density quantity through material properties.

## How to Learn This Topic

Begin each problem by identifying the geometry before choosing an equation. Ask where the sources are, which direction the field can point, which coordinate system follows the symmetry, and whether the field magnitude can remain constant on a selected path or surface. This prevents many errors that arise from applying a familiar formula to the wrong geometry.

Treat integral laws and differential laws as two views of the same behavior. An integral law describes what happens across a finite surface or around a finite contour. Divergence and curl describe the corresponding behavior near one point. When a derivation moves from one form to the other, follow the geometry of the shrinking surface or contour rather than memorizing the final operator.

For each formula, identify the predicted quantity, the source quantity, the direction, the material parameter, and the region of validity. Pay close attention to dot products, cross products, surface normals, contour orientation, and source-to-field displacement vectors. A sign usually records a physical direction or orientation rather than an arbitrary convention.

Work through the subsections in order. Predict the direction and qualitative dependence of a result before calculating it. Use symmetry to anticipate cancellations. When an interactive visual appears, make a prediction before changing a control, then compare the observed field, flux, force, or waveform with that prediction. Attempt each question before opening its detailed answer.

Basic algebra, trigonometry, derivatives, integrals, and introductory physics are assumed. Vector operations, coordinate bases, line and surface integrals, gradient, divergence, and curl are developed or refreshed where they first become necessary.

## Recommended Reading Order

1. Start with [[learning/1. Vectors, Coordinates, and Electric Force/_index|Vectors, Coordinates, and Electric Force]]. Read [[learning/1. Vectors, Coordinates, and Electric Force/1.1 Fields as Spatial Vector Quantities|Fields as Spatial Vector Quantities]], [[learning/1. Vectors, Coordinates, and Electric Force/1.2 Vector Components, Projections, and Orientation|Vector Components, Projections, and Orientation]], [[learning/1. Vectors, Coordinates, and Electric Force/1.3 Cylindrical and Spherical Coordinate Geometry|Cylindrical and Spherical Coordinate Geometry]], and [[learning/1. Vectors, Coordinates, and Electric Force/1.4 Coulomb Force and Electric Field Intensity|Coulomb Force and Electric Field Intensity]] in that order. These pages establish the notation, orientation rules, coordinate geometry, and point-charge field used throughout the garden.

2. Continue to [[learning/2. Charge, Flux, and Gauss's Law/_index|Charge, Flux, and Gauss's Law]]. Follow [[learning/2. Charge, Flux, and Gauss's Law/2.1 Superposition for Discrete and Continuous Charge|Superposition for Discrete and Continuous Charge]], [[learning/2. Charge, Flux, and Gauss's Law/2.2 Electric Flux Density and Gauss's Law|Electric Flux Density and Gauss's Law]], [[learning/2. Charge, Flux, and Gauss's Law/2.3 Gaussian Surfaces Chosen by Symmetry|Gaussian Surfaces Chosen by Symmetry]], and [[learning/2. Charge, Flux, and Gauss's Law/2.4 Divergence and the Divergence Theorem|Divergence and the Divergence Theorem]]. This sequence moves from adding source contributions to global flux laws and then to their local form.

3. Read [[learning/3. Potential, Energy, Current, and Dielectrics/_index|Potential, Energy, Current, and Dielectrics]] next. Proceed through [[learning/3. Potential, Energy, Current, and Dielectrics/3.1 Work, Potential, and the Potential Gradient|Work, Potential, and the Potential Gradient]], [[learning/3. Potential, Energy, Current, and Dielectrics/3.2 Energy Stored in Electric Fields|Energy Stored in Electric Fields]], [[learning/3. Potential, Energy, Current, and Dielectrics/3.3 Current Density and Charge Conservation|Current Density and Charge Conservation]], [[learning/3. Potential, Energy, Current, and Dielectrics/3.4 Conductors, Polarization, and Permittivity|Conductors, Polarization, and Permittivity]], and [[learning/3. Potential, Energy, Current, and Dielectrics/3.5 Electric Boundary Conditions and Capacitance|Electric Boundary Conditions and Capacitance]]. These pages connect electric fields to work, storage, transport, material response, interfaces, and conductor geometry.

4. Move to [[learning/4. Magnetic Fields, Circulation, and Flux/_index|Magnetic Fields, Circulation, and Flux]]. Read [[learning/4. Magnetic Fields, Circulation, and Flux/4.1 Magnetic Fields from Current with Biot-Savart|Magnetic Fields from Current with Biot-Savart]], [[learning/4. Magnetic Fields, Circulation, and Flux/4.2 Ampere's Law for Symmetric Current Systems|Ampere's Law for Symmetric Current Systems]], [[learning/4. Magnetic Fields, Circulation, and Flux/4.3 Curl as Local Circulation|Curl as Local Circulation]], and [[learning/4. Magnetic Fields, Circulation, and Flux/4.4 Stokes' Theorem, Magnetic Flux, and Flux Density|Stokes' Theorem, Magnetic Flux, and Flux Density]]. The order mirrors the electric-field sequence: sources first, then integral laws, local operators, and flux.

5. Continue with [[learning/5. Magnetic Potentials, Forces, Materials, and Inductance/_index|Magnetic Potentials, Forces, Materials, and Inductance]]. Follow [[learning/5. Magnetic Potentials, Forces, Materials, and Inductance/5.1 Scalar and Vector Magnetic Potentials|Scalar and Vector Magnetic Potentials]], [[learning/5. Magnetic Potentials, Forces, Materials, and Inductance/5.2 Lorentz Force on Moving Charge|Lorentz Force on Moving Charge]], [[learning/5. Magnetic Potentials, Forces, Materials, and Inductance/5.3 Magnetization and Magnetic Material Classes|Magnetization and Magnetic Material Classes]], and [[learning/5. Magnetic Potentials, Forces, Materials, and Inductance/5.4 Magnetic Energy, Flux Linkage, and Inductance|Magnetic Energy, Flux Linkage, and Inductance]]. This section connects magnetic fields to alternative potentials, particle motion, material response, energy, and coil behavior.

6. Finish with [[learning/6. Maxwell's Equations and Free-Space Waves/_index|Maxwell's Equations and Free-Space Waves]]. Read [[learning/6. Maxwell's Equations and Free-Space Waves/6.1 Maxwell's Equations as a Unified Field System|Maxwell's Equations as a Unified Field System]], [[learning/6. Maxwell's Equations and Free-Space Waves/6.2 Displacement Current and the Ampere-Maxwell Law|Displacement Current and the Ampere-Maxwell Law]], [[learning/6. Maxwell's Equations and Free-Space Waves/6.3 Electromagnetic Waves from Maxwell's Equations|Electromagnetic Waves from Maxwell's Equations]], and [[learning/6. Maxwell's Equations and Free-Space Waves/6.4 Phasors, Helmholtz Form, and Free-Space Impedance|Phasors, Helmholtz Form, and Free-Space Impedance]]. Each page depends on the divergence, curl, constitutive, and boundary ideas established earlier.

## Scope

This garden covers vector field methods, electrostatic force and field, distributed charge, electric flux, Gauss's law, divergence, potential, energy, current, charge conservation, conductor and dielectric response, electric boundary conditions, capacitance, magnetic fields from current, Ampere's law, curl, Stokes' theorem, magnetic flux, magnetic potentials, Lorentz force, magnetization, magnetic materials, inductance, Maxwell's equations, displacement current, and free-space waves.

It does not develop a full sequence on Poisson's equation, Laplace's equation, or finite-difference electrostatics. Magnetic boundary conditions and Faraday-law applications do not receive separate units, although the changing-magnetic-flux law appears within Maxwell's unified system. Wave propagation in materials, attenuation, and skin effect are outside the free-space wave treatment.

Transmission lines, Smith charts, reflection and refraction systems, guided waves, antennas, standalone Poynting-theorem analysis, recipe-style problem catalogues, and exam-specific training are also outside the current scope. The wave sequence ends with phasors, the free-space Helmholtz equation, propagation direction, and free-space intrinsic impedance.