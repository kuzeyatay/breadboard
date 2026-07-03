---
title: "Mathematics 2 - Lec 1-1"
date: "2026-06-04T10:51:56.932Z"
source: "upload"
knowledge_type: "source-document"
source_type: "pdf"
source_file: "Mathematics 2 - Lec 1-1.pdf"
generated_by: "chatmock"
topics: []
tags: ["mathematics-lec", "lec", "mathematics"]
source_pdf: "/math-2/assets/mathematics-2-lec-1-1-source.pdf"
---

## Summary

[[Page 1]]
Mathematics 2
(5EZB0)
Lecture 1
Koondi Mitra
Mathematics & Computer Science
Department

[[Page 2]]
Multivariable calculus
Electromagnetism
∇ · E = ρ / ε₀, ∇ × E = - ∂B / ∂t
∇ · B = 0, ∇ × B = μ₀J + μ₀ε₀ ∂E / ∂t
Signal processing
f(x) = a₀/2 + Σ(aₙcos(nπx/L) + bₙsin(nπx/L))
Circuit design


## Knowledge tree

- No knowledge topics were extracted.

## Source material

## Page 1

Mathematics 2
(5EZB0)
Lecture 1
Koondi Mitra
Mathematics & Computer Science
Department

## Page 2

Multivariable calculus
Electromagnetism
∇ * E = ρ / ε_0, ∇ x E = - ∂B / ∂t
∇ * B = 0, ∇ x B = μ_0J + μ_0ε_0 ∂E / ∂t
Signal processing
f(x) = a_0/2 + Σ(aₙcos(nπx/L) + bₙsin(nπx/L))
Circuit design
Quantum mechanics Power generation
ρ (∂v/∂t + (v * ∇)v) = -∇p + ∇ * T
+ (1/μ_0)(∇ x B) x B
∂v/∂t + (v ⋅ ∇)v = -1/ρ ∇p + ν∇2v
Automotive
𝐿(𝑑2𝐼/𝑑𝑡2) + (1/𝐶) 𝐼 = 0

## Page 3

Moving to 3D
Let us first consider Cartesian coordinate system with 𝑥, 𝑦, 𝑧 axes
➢ They have to be oriented by the right-handed rule
➢ They need to satisfy
𝒊 x 𝒋 = 𝒌
𝒌 x 𝒊 = 𝒋
𝒋 x 𝒌 = 𝒊
➢ The coordinate is P = 𝑥, 𝑦, 𝑧 or
𝒙 = 𝑥 𝒊 + 𝑦 𝒋 + 𝑧 𝒌
➢ Distance from the origin
| 𝒙 |= 𝑥2 + 𝑦2 + 𝑧2

## Page 4

Euclidean distance
➢ Distance between 2 points P1 = 𝑥1, 𝑦1, 𝑧1 and
P2 = 𝑥2, 𝑦2, 𝑧2 :
𝒙𝟐 - 𝒙𝟏 = 𝑥2 - 𝑥1 2 + 𝑦2 - 𝑦1 2 + 𝑧2 - 𝑧1 2
1. What is the orientation of 𝑥-axis in the
picture below?
2. What is the length of (3,4,12) and what is
the angle it makes with the 𝑥-axis?
Questions
𝑧 𝑦

## Page 5

Equation of planes
➢ The equation of a plane is for constants 𝑎, 𝑏, 𝑐, 𝑑 ∈ ℝ,
𝑎𝑥 + 𝑏𝑦 + 𝑐𝑧 = 𝑑
or if 𝒏 = 𝑎𝒊 + 𝑏𝒋 + 𝑐𝒌, then 𝒏 ⋅ 𝒙 = 𝑑.
To see how the plane changes for 𝑐 > 0
play with the python code plane.py
𝑥 + 𝑦 + 𝑧 = 1
𝑥 = 𝑦

## Page 6

Equation of planes
➢ The equation of a plane is for constants 𝑎, 𝑏, 𝑐, 𝑑 ∈ ℝ,
𝑎𝑥 + 𝑏𝑦 + 𝑐𝑧 = 𝑑
or if 𝒏 = 𝑎𝒊 + 𝑏𝒋 + 𝑐𝒌, then 𝒏 ⋅ 𝒙 = 𝑑.
𝑥 + 𝑦 + 𝑧 = 1
1. What is the unit normal to the plane
𝑥 + 2𝑦 + 3𝑧 = 4?
2. What is geometry of the intersection
between 𝑥 + 𝑦 + 𝑧 = 1 and the plane
above?
Questions

## Page 7

Half spaces
➢ We get a half space if either
𝑎𝑥 + 𝑏𝑦 + 𝑐𝑧 > 𝑑
or if 𝑎𝑥 + 𝑏𝑦 + 𝑐𝑧 < 𝑑
𝑦 > 𝑥
1. 𝑦 > 𝑥 is a half space
2. {𝑥 > 0, 𝑦 > 0, 𝑧 > 0} is an octant which is
the intersection of the three half-spaces
𝑥 > 0, 𝑦 > 0 and 𝑧 > 0
Examples

## Page 8

Open and closed sets
➢ We define the ball of radius 𝑟 > 0 centered at 𝒙 ∈ ℝ𝑛 as
𝐵𝑟 𝒙 ≔ {𝒚 ∈ ℝ𝑛: |𝒚 - 𝒙| < 𝑟}
➢ 𝑆 ⊆ ℝ𝑛 is open if for all 𝒙 ∈ 𝑆, there exists an 𝑟 > 0 such that
𝐵𝑟 𝒙 ⊆ 𝑆
➢ A set 𝑆 is closed if its complement 𝑆𝑐 is open.
1. Is {𝑥 + 2𝑦 + 3𝑧 >= 4} an open or a
closed set?
2. Is {𝑥2+𝑦2 < 1} open?
3. Is 𝑥2 + 𝑦2 < 1 & 𝑦 >= 𝑥 open or
closed?
Questions

## Page 9

Quadric surfaces
➢ Next, we discuss quadric surfaces which arise from the equation
𝐴𝑥2 + 𝐵𝑦2 + 𝐶𝑧2 + 𝐷𝑥𝑦 + 𝐸𝑥𝑧 + 𝐹𝑦𝑧 + 𝐺𝑥 + 𝐻𝑦 + 𝐼𝑧 = 𝐽
➢ Observe that the 𝑧 = 𝑘 intersection of above equations are conic
sections given by
𝐴𝑥2 + 𝐵𝑦2 + 𝐷𝑥𝑦 + 𝐺′𝑥 + 𝐻′𝑦 = 𝐽′ ′
To see how the quadric surfaces change
for 𝑐 >= 0 play with the python code
quadric_surface.py

## Page 10

Quadric surfaces
Pair of planes
𝑎1𝑥 + 𝑏1𝑦 + 𝑐1𝑧 - 𝑑1 𝑎1𝑥 + 𝑏1𝑦 + 𝑐1𝑧 - 𝑑2 = 0
Cylinders along z-axis
𝐴𝑥2 + 𝐵𝑦2 + 𝐷𝑥𝑦 + 𝐺𝑥 + 𝐻𝑦 = 𝐽
Cones centered at (𝑥0, 𝑦0, 𝑧0)
𝑧 - 𝑧0 2
𝑐2 = 𝑥 - 𝑥0 2
𝑎2 + 𝑦 - 𝑦0 2
𝑏2
Ellipsoids centered at (𝑥0, 𝑦0, 𝑧0)
𝑥 - 𝑥0 2
𝑎2 + 𝑦 - 𝑦0 2
𝑏2 + 𝑧 - 𝑧0 2
𝑐2
= 1

## Page 11

Quadric surfaces
Elliptic paraboloids
𝑧 - 𝑧0 = 𝑥 - 𝑥0 2
𝑎2 + 𝑦 - 𝑦0 2
𝑏2
Hyperbolic paraboloids
𝑧 - 𝑧0 = 𝑥 - 𝑥0 2
𝑎2 - 𝑦 - 𝑦0 2
𝑏2
Hyperboloid of one sheet
𝑧 - 𝑧0 2
𝑐2 = 𝑥 - 𝑥0 2
𝑎2 + 𝑦 - 𝑦0 2
𝑏2 - 1
Hyperboloid of two sheets
𝑧 - 𝑧0 2
𝑐2 = 𝑥 - 𝑥0 2
𝑎2 + 𝑦 - 𝑦0 2
𝑏2 + 1

## Page 12

Quadric surfaces
1. What kind of surface is
𝑥2 + 𝑦2 + 2𝑧2 = 2𝑦 - 8𝑧?
2. What is the equation of a sphere of
radius 𝑟 > 0 centered at (1,2,3)?
3. What is the relation between conic
sections and the quadric surfaces?
Analyze the case of hyperboloids.
Questions
4. What is the intersection between
𝑥2 + 2𝑦2 + 3𝑧2 = 6 and 𝑥 = 𝑦?
5. Find a unit vector 𝒏 perpendular to
which if you intersect the elliptic cone
𝑥2 + 2𝑦2 = 1 then you get a circle.
Questions

## Page 13

Cylindrical coordinates
➢ Useful coordinate system to describe cylindrical objects such
as, wire, axle, etc.
➢ Represented by 𝑟, 𝜃, 𝑧 where 𝑟 >= 0, 𝑧 ∈ ℝ and 𝜃 ∈ -𝜋, 𝜋
➢ The coordinate in in terms of (𝑥, 𝑦, 𝑧)
𝒙 = 𝑟 cos 𝜃, 𝑟 sin 𝜃, 𝑧
➢ Distance from the origin 𝒙 = 𝑟2 + 𝑧2

## Page 14

Spherical coordinates
➢ Useful coordinate system to describe radially symmetric
phenomena such Columbs law, atoms, balls, etc.
➢ Represented by 𝑅, 𝜙, 𝜃 where 𝑅 >= 0, 𝜙 ∈ 0, 𝜋 , 𝜃 ∈ -𝜋, 𝜋
➢ The coordinate in in terms of (𝑥, 𝑦, 𝑧)
𝒙 = 𝑅 sin 𝜙 cos 𝜃, 𝑅 sin 𝜙 sin 𝜃, 𝑅 cos 𝜙
➢ Observe that tan 𝜙 = 𝑟
𝑧 = 𝑥2+𝑦2
𝑧 , tan 𝜃 = 𝑦
𝑥

## Page 15

Different coordinate systems
1. What are the surfaces that
correspond to
𝜃 = 𝜋
4 , 𝜙 = 𝜋
3 , 𝑅 = 2, 𝑟 = 4?
2. What is the equation of an ellipsoid
in cylindrical coordinate centered at
(0,0,0) and having major axis lengths
6,6,4 along 𝑥, 𝑦, 𝑧 axes?
Questions
Surface match
