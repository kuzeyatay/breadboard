---
title: "5EZB0_SC_week6"
date: "2026-06-04T10:51:02.238Z"
source: "upload"
knowledge_type: "source-document"
source_type: "pdf"
source_file: "5EZB0_SC_week6.pdf"
generated_by: "chatmock"
topics: []
tags: ["5ezb0-week6", "5ezb0", "week6"]
source_pdf: "/math-2/assets/5ezb0-sc-week6-source.pdf"
---

## Summary

[[Page 1]]
Mathematics 2 (5EZB0)
Studio classroom 2 – Week 6
May 28, 2026
Rob Mestrom
/e

[[Page 2]]
2
Topics for today
▶ Vector functions of one variable and parametrizations
(Adams 12.1 & 12.3)
▶ Gradient and directional derivatives
(Adams 13.7 + extra)

[[Page 3]]
3
Vector functions of one variab

## Knowledge tree

- No knowledge topics were extracted.

## Source material

## Page 1

Mathematics 2 (5EZB0)
Studio classroom 2 - Week 6
May 28, 2026
Rob Mestrom
/e

## Page 2

2
Topics for today
▶ Vector functions of one variable and parametrizations
(Adams 12.1 & 12.3)
▶ Gradient and directional derivatives
(Adams 13.7 + extra)

## Page 3

3
Vector functions of one variable and
parametrization
Unfinished business from Studio classroom week 2

## Page 4

4
Studio classroom - Problem 1
The position, velocity, and acceleration of a particle moving in 3D are given
by r(t), v(t), and a(t) as a function of time t, respectively.
Furthermore, it is given that at every time t, the acceleration a is
perpendicular to both r and v.
(a) Show that the vector r(t) - tv(t) has constant length.

## Page 5

5
Studio classroom - Problem 2
The position of an object as a function of time t can be described by the
piecewise smooth curve r = t3ˆı + t2ˆȷ.
(a) Give expressions for the velocity v and acceleration a of the object as a
function of time.
(b) Calculate the distance the object has travelled (the length of the curve)
between t = -1 and t = 2 s.

## Page 6

6
Gradient
Cartesian coordinates

## Page 7

7
Gradient in Cartesian coordinates
Gradient operator ∇ (or grad):
∇f = grad f =

ˆı ∂
∂ x + ˆȷ ∂
∂ y + ˆ	k ∂
∂ z

f
Properties:
▶ operates on scalar field f = f (x, y, z)
to yield a vector field
▶ direction of ∇f :
- direction in which f increases most
rapidly
- perpendicular to level sets

## Page 8

8
Gradient: example in 2D
For 0 < x < 1 and 0 < y < 2, consider the function
Ψ(x, y) = sin(2πx) sin(2πy)
Use MATLAB to make plots of
▶ contours Ψ(x, y) = Ψ0 ("level map")
▶ the gradient
∇Ψ(x, y) = 2π  cos(2πx) sin(2πy)ˆı +
sin(2πx) cos(2πy) ˆȷ

## Page 9

9
Gradient: example in 2D
x-axis
y-axis
0 	0.2 	0.4 	0.6 	0.8 	1
	0
0.2
0.4
0.6
0.8
1
1.2
1.4
1.6
1.8
2
0
0.5
1
0
0.5
1
1.5
2
-1
-0.5
0
0.5
1
x-axis
y-axis

## Page 10

10
Gradients in physics
Examples

## Page 11

11
Diffusion current (semiconductor phyics)
▶ Diffusion is based on concentration difference, not on charge of carriers
Sedra & Smith, Fig 1.33
▶ Temperature will cause all
carriers to move in all directions
Net flow
+
+
+
+
+
+
▶ Local concentration difference will
lead to net flow of carriers in
direction of lower concentration

## Page 12

12
Diffusion current, equations
Diffusion constant (diffusivity): D = kT
q μ unit: cm2/s
ndiffusion
def
== -Dn
dn
dx n, p = carriers / volume
pdiffusion
def
== -Dp
dp
dx n, pdiffusion = diffusive flux
Jn,diffusion = qDn
dn
dx = kTμn
dn
dx
Jp,diffusion = -qDp
dp
dx = kTμp
dp
dx
(Find current I by integrating current density J over device area)
Jdiffusion = kT

μn
dn
dx - μp
dp
dx


## Page 13

13
Diffusion: Fick's law
ϕ(x, t): concentration of particles
Jx(x, t): diffusive flux in x-direction
(number of particles moving per unit of area per unit of time)
Fick's law in one dimension: Jx(x, t) = -Ddϕ(x, t)
dx
with D the diffusivity
Fick's law generalized to three dimensions: J = -D∇ϕ
-∇ϕ: local direction towards lower concentration

## Page 14

14
Conservative forces (one dimension)
▶ Conservative force at position x can be obtained from
potential energy function as function of x
Fx(x) = -dU(x)
dx
▶ In regions where U(x) changes rapidly with x -> large force
(magnitude)
▶ When Fx(x) is in positive x-direction, U(x) decreases with
increasing x
▶ Conservative force always acts to push the system towards
lower potential energy

## Page 15

15
One dimensional: elastic potential energy
Copyright © 2020 Pearson Education Ltd. All Rights Reserved
F = Fx = -dU
dx

## Page 16

16
One dimensional: gravitational potential energy
F = Fy = -dU
dy
Copyright © 2020 Pearson Education Ltd. All Rights Reserved

## Page 17

17
General approach: three dimensions
Potential energy function can depend on 3D position (e.g.
Cartesian) as U = U(x, y, z)
The three force components of force vector F at any point
(x, y, z) in space then are
Fx = -∂ U
∂ x , Fy = -∂ U
∂ y , Fz = -∂ U
∂ z
F = -

ˆı ∂
∂ x + ˆȷ ∂
∂ y + ˆ	k ∂
∂ z

U = -∇U

## Page 18

18
Studio classroom - Problem 3
A static electric field E is also a conservative field, which can be determined
from a known electric potential V using E = -∇V
Calculate the electric field in Cartesian coordinates for the following two
cases:
(a) An infinitely long line carrying a constant charge density ρL (C/m),
for which the electric potential is given by V = - ρL
2πϵ0
ln Æx2 + y2.
(b) A point charge q (C) in the origin, for which the electric potential
is given by V = q
4πϵ0
px2 + y2 + z2

## Page 19

19
Gradient
Cylindrical coordinates

## Page 20

20
Cylindrical coordinates (recap)
Coordinates
x = r cos θ
y = r sin θ
z = z
Unit vectors
ˆr = cos θˆı + sin θ ˆȷ
ˆ	θ = - sin θˆı + cos θ ˆȷ
ˆ	k = ˆ	k

## Page 21

21
Gradient in cylindrical coordinates
Two approaches possible:
1. Following formal mathematical derivation (see Math 2
lectures) -> brief summary included
2. Easier, faster derivation (more intuitive, hopefully) ->
detailed derivation
Similar approaches could be used for spherical coordinates

## Page 22

22
Approach 1 - Gradient in cylindrical coordinates
Start from the gradient operator in Cartesian coordinates
∇ = ˆı ∂
∂ x + ˆȷ ∂
∂ y + ˆ	k ∂
∂ z
Express this in terms of cylindrical coordinates, for which the
gradient operator needs to look like
∇ = a ˆr ∂
∂ r + b ˆ	θ ∂
∂ θ + c ˆ	k ∂
∂ z
and determine 'scaling' factors a, b, c

## Page 23

23
Approach 1 - Gradient in cylindrical coordinates (cont'd)
Use chain rule for derivatives
∂
∂ r = ∂ x
∂ r
∂
∂ x + ∂ y
∂ r
∂
∂ y + ∂ z
∂ r
∂
∂ z, ∂
∂ θ = ∂ x
∂ θ
∂
∂ x + ∂ y
∂ θ
∂
∂ y + ∂ z
∂ θ
∂
∂ z
∂
∂ z = ∂
∂ z
and several square metres of blackboard to arrive at
∇ = ˆr ∂
∂ r + ˆ	θ 1
r
∂
∂ θ + ˆ	k ∂
∂ z

## Page 24

24
Approach 2 - Intermezzo: Cartesian example
Consider scalar function of three variables f (x, y, z)
▶ ∆f in going from (x, y, z) to
(x + ∆x, y + ∆y, z + ∆z):
∆f = ∂ f
∂ x ∆x + ∂ f
∂ y∆y + ∂ f
∂ z∆z + . . .
▶ Vector displacement
∆s = ˆı ∆x + ˆȷ ∆y + ˆ	k ∆z
allows us to write
∆f =

ˆı ∂ f
∂ x + ˆȷ ∂ f
∂ y + ˆ	k ∂ f
∂ z

* ∆s + . . .

## Page 25

25
Approach 2 - Intermezzo: Cartesian example (cont'd)
▶ Next, write ∆s = ˆ	u∆s (unit vector times length)
and take the limit
lim
∆s->0
∆f
∆s = df
ds =

ˆı ∂ f
∂ x + ˆȷ ∂ f
∂ y + ˆ	k ∂ f
∂ z

| {z }
gradient
*ˆ	u

## Page 26

26
Approach 2 - Gradient in cylindrical coordinates
Consider scalar function of three variables f (r, θ , z)
▶ ∆f in going from (r, θ , z) to
(r + ∆r, θ + ∆θ , z + ∆z):
∆f = ∂ f
∂ r∆r + ∂ f
∂ θ ∆θ + ∂ f
∂ z∆z + . . .
▶ Vector displacement
∆s = ˆr ∆r + ˆ	θ r∆θ + ˆ	k ∆z
allows us to write
∆f =

ˆr∂ f
∂ r + ˆ	θ 1
r
∂ f
∂ θ + ˆ	k ∂ f
∂ z

* ∆s + . . .

## Page 27

27
Approach 2 - Gradient in cylindrical coordinates (cont'd)
▶ Next, write ∆s = ˆ	u∆s (unit vector times length)
and take the limit
lim
∆s->0
∆f
∆s = df
ds =

ˆr∂ f
∂ r + ˆ	θ 1
r
∂ f
∂ θ + ˆ	k ∂ f
∂ z

| {z }
gradient
*ˆ	u

## Page 28

28
Summary - gradient in three coordinate systems
Cartesian:
∇f = ∂ f
∂ xˆı + ∂ f
∂ y ˆȷ + ∂ f
∂ z
ˆ	k
Circular cylindrical:
∇f = ∂f
∂rˆr + 1
r
∂f
∂θ ˆ	θ + ∂f
∂z
ˆ	k
Spherical:
∇f = ∂f
∂R ˆ	R + 1
R
∂f
∂φ ˆ	φ + 1
R sin(φ)
∂f
∂θ ˆ	θ

## Page 29

29
Studio classroom - Problem 4
Calculate the gradients of the given scalar fields expressed in terms of
cylindrical or spherical coordinates:
(a) f (r, θ , z) = rθ z
(b) f (R, φ, θ ) = Rφθ

## Page 30

30
Studio classroom - Problem 5
Let us revisit the static electric field E (conservative field), which can be
determined from an known electric potential V using E = -∇V
Calculate the electric field for the following two cases:
(a) In cylindrical coordinates: an infinitely long line carrying a constant
charge density ρL (C/m), for which the electric potential is given by
V = - ρL
2πϵ0
ln r.
(b) In spherical coordinates: a point charge q (C) in the origin, for which the
electric potential is given by V = q
4πϵ0R
