---
title: "Mass-Spring-Damper Phase Plane"
date: "2026-04-30T16:26:39.261Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "signals-and-systems-full-notes"
source_file: "Signals and Systems full notes.pdf"
locations: ["Page 56"]
related: ["second-order-linear-constant-coefficient-equations", "characteristic-equation-and-root-cases"]
tags: ["spring-damper-system", "phase-plane", "spring-force", "damping-force", "newtons-second-law"]
---

## Mass-Spring-Damper Phase Plane

Source: [[signals-and-systems-full-notes|Signals and Systems Full Notes: Sinusoids, Spectra, Sampling, Aliasing, and FIR Filters]]

Locations: Page 56

The mass-spring-damper model is used to connect second-order ODEs with physical systems and phase-plane geometry. A mass attached to a spring and damper experiences spring force $F_s=-kx$ and friction or damping force $F_e=-bv$, where $v=\dot{x}$. Since acceleration is $\ddot{x}$ and Newton's law gives $F=ma$, the total force equation becomes $m\ddot{x}=-kx-b\dot{x}$, or $m\ddot{x}+b\dot{x}+kx=0$. The phase plane is the $(x,\dot{x})$ plane, where every point represents the full state of the system: position and velocity. Instead of plotting $x(t)$ and $v(t)$ separately against time, the phase plane gives a compact representation of how the state moves over time. The notes show a trajectory circling or spiraling around the origin with arrows, representing the evolution of the spring-mass-damper state.

### Page-grounded details

#### Page 56

Why lets looking at a system that is now as a spring damper system

[Diagram: horizontal spring attached to a vertical wall, connected to a mass on the right. A displacement arrow labeled x points to the right above the mass. A force arrow on the mass points left labeled Fs = -kx. A wavy input/ground line appears on the left labeled [unclear].]

Total force acting on the system is:

ΣF = Fs + Fe     with Fs = -kx and Fe = -bv

[annotation above Fe: friction]

we know that ẋ = v (derivative of position is velocity) therefore
substitute: (dot notation more intuitive when with reference to time)

ΣF = Fs + Fe = -kx - bv = -kx - bẋ

we also know that ẍ = a and F = ma

∴ mẍ = -kx - bẋ

∴ mẍ + bẋ + kx = 0     is the mass-spring-damper equation

1-> The phase plane, is the (x, ẋ) plane in which every point represents
a complete state of the system and in which the differential equation
describes how that point moves over time.

[Graph: x(t) versus t. Vertical axis labeled x(t), horizontal axis labeled t. Curve rises, falls, rises again, then falls.]

[Graph: v(t) versus t. Vertical axis labeled v(t), horizontal axis labeled t. Curve starts high, dips low, rises again, then falls.]

[Truncated for analysis]

### Key points

- The spring force is modeled as $F_s=-kx$.
- The damping force is modeled as $F_e=-bv$.
- Velocity is $v=\dot{x}$.
- Newton's law gives $m\ddot{x}=-kx-b\dot{x}$.
- The mass-spring-damper equation is $m\ddot{x}+b\dot{x}+kx=0$.
- The phase plane uses coordinates $(x,\dot{x})$ to represent system state.

### Related topics

- [[second-order-linear-constant-coefficient-equations|Second-Order Linear Constant-Coefficient Equations]]
- [[characteristic-equation-and-root-cases|Characteristic Equation and Root Cases]]

### Relationships

- example-of: [[second-order-linear-constant-coefficient-equations|Second-Order Linear Constant-Coefficient Equations]]
