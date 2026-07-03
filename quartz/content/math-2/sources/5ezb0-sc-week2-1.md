---
title: "5EZB0_SC_week2-1"
date: "2026-06-04T10:51:05.730Z"
source: "upload"
knowledge_type: "source-document"
source_type: "pdf"
source_file: "5EZB0_SC_week2-1.pdf"
generated_by: "chatmock"
topics: []
tags: ["5ezb0-week2", "5ezb0", "week2"]
source_pdf: "/math-2/assets/5ezb0-sc-week2-1-source.pdf"
---

## Summary

[[Page 1]]
Mathematics 2 (5EZB0)
Studio classroom 1 – Week 2
April 30, 2026
Rob Mestrom
/e

[[Page 2]]
2
Studio classroom
▶ Recap some of the topics covered in the lectures
▶ Cover relevant new bits and pieces of theory
▶ Relate mathematics concepts to engineering examples
(Physics for EE/AT, Electr

## Knowledge tree

- No knowledge topics were extracted.

## Source material

## Page 1

Mathematics 2 (5EZB0)
Studio classroom 1 - Week 2
April 30, 2026
Rob Mestrom
/e

## Page 2

2
Studio classroom
▶ Recap some of the topics covered in the lectures
▶ Cover relevant new bits and pieces of theory
▶ Relate mathematics concepts to engineering examples
(Physics for EE/AT, Electromagnetics I)
▶ Work together on suitable examples
▶ Active participation: some time to try yourselves, then
plenary solution on blackboard
Goal: show that math is relevant and fun at the same time!

## Page 3

3
Studio classroom (cont'd)
Incentive for attending the sessions:
▶ Learn how to put math to good/relevant use
▶ Problems in tests on application of the mathematics

## Page 4

4
Topics for today
▶ Coordinate systems and their unit vectors
(Adams 10.5 + extra)
▶ Vector functions of one variable and parametrizations
(Adams 12.1 & 12.3)

## Page 5

5
Coordinate systems
Cartesian, cylindrical, spherical
. . . and their unit vectors

## Page 6

6
Coordinate systems
Properties of coordinate systems:
▶ unique representation of a point in 3D-space
▶ directions orthogonal in each point
▶ convention: choose right-handed
Commonly used coordinate systems for engineering:
▶ Cartesian or rectangular coordinates
▶ circular cylindrical coordinates
▶ spherical coordinates

## Page 7

7
Cartesian coordinates
Unit vectors:
ˆı, ˆȷ, ˆ	k
Position vector:
rP = xˆı + y ˆȷ + z ˆ	k
Vector field:
A = Axˆı + Ayˆȷ + Azˆ	k
Note: unit vectors relate to small changes in position vector with x, y, and z coordinates

## Page 8

8
Circular cylindrical coordinates
Represented by [r, θ , z]
r >= 0, θ ∈ [-π, π], z ∈ R

## Page 9

9
Circular cylindrical coordinates
Definition:
x = r cos θ
y = r sin θ
z = z
r = Æx2 + y2
tan θ = y
x

## Page 10

10
Circular cylindrical coordinates - vectors
Unit vectors:
ˆr, ˆ	θ , ˆ	k
Position vector:
rP = r ˆr(θ ) + z ˆ	k
Vector field:
A = Ar ˆr + Aθ ˆ	θ + Az ˆ	k
Note: unit vectors relate to small changes in position vector with r, θ , and z coordinates

## Page 11

11
Spherical coordinates
Represented by [R, φ, θ ]
R >= 0, φ ∈ [0, π]
θ ∈ [-π, π]

## Page 12

12
Spherical coordinates (cont'd)
Definition:
x = R sin φ cos θ
y = R sin φ sin θ
z = R cos φ
R = Æx2 + y2 + z2 =
p
r2 + z2
cos φ = z
R, tan φ = r
z
tan θ = y
x

## Page 13

13
Spherical coordinates (cont'd)
Unit vectors:
ˆ	R, ˆ	φ, ˆ	θ
Position vector:
rP = R ˆ	R(φ, θ )
Vector field:
A = AR ˆ	R + Aφ ˆ	φ + Aθ ˆ	θ
Note: unit vectors relate to small changes in position vector with R, φ, and θ coordinates

## Page 14

14
Studio classroom problems

## Page 15

15
Studio classroom - Problem 1
Point A is located at [r, θ , z] = [12, 3π
2 , 2] in cylindrical coordinates.
Point B is located at [R, φ, θ ] = [2, 2π
3 , π
4 ] in spherical coordinates.
(a) Find the position vector rA pointing from the origin to point A in
Cartesian coordinates.
(b) Find the distance between points A and B.

## Page 16

16
Studio classroom - Problem 2
The unit vectors ˆr(θ ) in cylindrical coordinates and ˆR(φ, θ ) in spherical
coordinates can be expressed in terms of Cartesian vectors ˆı, ˆȷ, and ˆk by
using expressions for x, y and z.
(a) Express ˆr(θ ) in Cartesian components.
(b) Express ˆR(φ, θ ) in Cartesian components.
(c) Express the unit vector which points from z = h
on the z-axis towards the (cylindrical) point
(r, θ , 0) in cylindrical coordinates.
(d) Does the expression obtained at (c) depend on
the angle θ ? If so, how?

## Page 17

17
Studio classroom - Problem 3
Consider a position vector in cylindrical coordinates r = r ˆr(θ ), where both r
and θ depend on time t.
(a) Show that for the cylindrical coordinate system, it holds that
dˆr
dθ = ˆθ and dˆθ
dθ = -ˆr
(b) Calculate the velocity v = ˙r = dr
dt and acceleration a = ˙v = dv
dt .
(c) Show that for uniform circular motion, with fixed radius a and constant
angular velocity ω, we get: v = aω ˆθ and a = -aω2ˆr.

## Page 18

18
A closer look at cylindrical coordinates
Path
Unit vectors in plane of constant z:
ˆr = cos θˆı + sin θ ˆȷ
ˆ	θ = - sin θˆı + cos θ ˆȷ
Position P on the path depends on time
▶ both r and θ can depend on time
▶ so do their unit vectors
▶
dˆr
dθ = ˆ	θ and d ˆ	θ
dθ = -ˆr
▶ ˙ˆr = ˙	θ ˆ	θ and ˙ˆ	θ = - ˙	θˆr

## Page 19

19
Vector functions of one variable and
parametrization

## Page 20

20
Studio classroom - Problem 4
The position, velocity, and acceleration of a particle moving in 3D are given
by r(t), v(t), and a(t) as a function of time t, respectively.
Furthermore, it is given that at every time t, the acceleration a is
perpendicular to both r and v.
(a) Show that the vector r(t) - tv(t) has constant length.

## Page 21

21
Studio classroom - Problem 5
An object moves to the right along the plane curve y = x2 (position in
meters) with a constant speed of v = 5 m/s.
(a) Determine the velocity and acceleration vectors of the object
when it is at the position (1, 1) m.

## Page 22

22
Studio classroom - Problem 6 (if time permits)
The position of an object as a function of time t can be described by the
piecewise smooth curve r = t3ˆı + t2ˆȷ.
(a) Give expressions for the velocity v and acceleration a of the object as a
function of time.
(b) Calculate the distance the object has travelled (the length of the curve)
between t = -1 and t = 2 s.
