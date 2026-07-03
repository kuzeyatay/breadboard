---
title: "Mathematics 2 - Lec 2"
date: "2026-06-04T10:51:55.049Z"
source: "upload"
knowledge_type: "source-document"
source_type: "pdf"
source_file: "Mathematics 2 - Lec 2.pdf"
generated_by: "chatmock"
topics: []
tags: ["mathematics-lec", "lec", "mathematics"]
source_pdf: "/math-2/assets/mathematics-2-lec-2-source.pdf"
---

## Summary

[[Page 1]]
Mathematics 2
(5EZB0)
Lecture 2
Koondi Mitra
Mathematics & Computer Science
Department

[[Page 2]]
Vector functions of one variable
Motion is characterized by a position vector
𝒓 𝑡 = 𝑥 𝑡 𝒊 + 𝑦 𝑡 𝒋 + 𝑧 𝑡 𝒌
Changing with time 𝑡 ∈ ℝ
Use functions_of_time.py to see how
the positio

## Knowledge tree

- No knowledge topics were extracted.

## Source material

## Page 1

Mathematics 2
(5EZB0)
Lecture 2
Koondi Mitra
Mathematics & Computer Science
Department

## Page 2

Vector functions of one variable
Motion is characterized by a position vector
𝒓 𝑡 = 𝑥 𝑡 𝒊 + 𝑦 𝑡 𝒋 + 𝑧 𝑡 𝒌
Changing with time 𝑡 ∈ ℝ
Use functions_of_time.py to see how
the position vector changes in 3D for
any given function of time

## Page 3

Velocity
The instantaneous rate of change of the position
vector is call velocity
𝒗 𝑡 = lim
Δt->0
𝒓 𝑡 + Δt - 𝒓 𝑡
Δt = 𝑑𝒓
𝑑𝑡
➢ The velocity vector's components are
velocities of the components
𝑑𝒓
𝑑𝑡 = 𝑑𝑥
𝑑𝑡 𝒊 + 𝑑𝑦
𝑑𝑡 𝐣+ 𝑑𝑧
𝑑𝑡 𝐤
➢ Speed: 𝑣 𝑡 = |𝒗(𝑡)|
➢ Velocity 𝒗(𝑡) is tangent to the trajectory
at the point 𝒓(𝑡)

## Page 4

Acceleration
The instantaneous rate of change of velocity is
called acceleration:
𝒂 𝑡 = lim
Δt->0
𝒗 𝑡 + Δt - 𝒗 𝑡
Δt = 𝑑𝒗
𝑑𝑡 = 𝑑2𝒓
𝑑𝑡2
➢ 𝒂 𝑡 = 𝑑2𝑥
𝑑𝑡2 𝒊 + 𝑑2𝑦
𝑑𝑡2 𝐣+ 𝑑2𝑧
𝑑𝑡2 𝐤

## Page 5

Velocity + Acceleration
velocity
𝒗 𝑡 = 𝑑𝒓
𝑑𝑡 = 𝑑𝑥
𝑑𝑡 𝒊 + 𝑑𝑦
𝑑𝑡 𝐣+ 𝑑𝑧
𝑑𝑡 𝐤
acceleration
𝒂 𝑡 = 𝑑𝒗
𝑑𝑡 = 𝑑2𝒓
𝑑𝑡2 = 𝑑2𝑥
𝑑𝑡2 𝒊 + 𝑑2𝑦
𝑑𝑡2 𝐣+ 𝑑2𝑧
𝑑𝑡2 𝐤
1. Conical helix: What is the velocity, speed,
and acceleration of the particle with
coordinate vectors (𝑡 cos 𝑡 , 𝑡 sin 𝑡 , 𝑡)?
2. What is the position vector and velocity of
a particle having constant acceleration 𝒈?
3. An ant walks around a cylinder of radius 2
cm oriented along 𝑧-axis, with constant
speed 5 cm/s, and goes along the axis with
speed 3 cm/s. If it starts (2,0,0), what is its
velocity and speed at that point?
Questions 1

## Page 6

Rules of differentiation
➢ 𝑑
𝑑𝑡 𝒖 𝑡 + 𝒗 𝑡 = 𝑑
𝑑𝑡 𝒖 𝑡 + 𝑑
𝑑𝑡 𝒗 𝑡 (Addition rule)
➢ 𝑑
𝑑𝑡 𝜆(𝑡) 𝒖 𝑡 = d
dt λ 𝑡 𝒖 𝑡 + λ 𝑡 d
dt 𝒖 𝑡 (Product rule)
➢ 𝑑
𝑑𝑡 𝒖 𝑡 ⋅ 𝒗 𝑡 = d
dt 𝒗 𝑡 ⋅ 𝒖 𝑡 + 𝒗 𝑡 ⋅ d
dt 𝒖 𝑡 (Product rule for dot products)
➢ 𝑑
𝑑𝑡 𝒖 𝑡 x 𝒗 𝑡 = 𝒖 𝑡 x d
dt 𝒗 𝑡 + d
dt 𝒖 𝑡 x 𝒗(𝑡) (Product rule for cross products)
➢ 𝑑
𝑑𝑡 𝒖(𝜆(𝑡)) = 𝑑
𝑑𝜆 𝒖 𝜆(𝑡) d
dt λ 𝑡 (Chain rule)
➢ 𝑑
𝑑𝑡 𝒖 𝑡 𝑠 = 𝑠 𝒖 𝑡 𝑠-2 𝒖 𝑡 ⋅ 𝑑
𝑑𝑡 𝒖 𝑡
1. Show that the speed of particle remains
constant only if the acceleration and
velocity are perpendicular.
Questions 2
2. What is 𝑑
𝑑𝑡 𝒓 x 𝑑
𝑑𝑡 𝒓 ? (an important relation)

## Page 7

Parametrization
Time can be used as a parameter to describe a surface,
curve: for a <= 𝑡 <= 𝑏,
𝒓 𝑡 = 𝑥 𝑡 𝒊 + 𝑦 𝑡 𝒋 + 𝑧 𝑡 𝒌
➢ Parametrization is not necessarily unique
➢ There can be more than 1 parameter (if you need to
describe a surface for example)
1. 𝒓 𝑡 = sin 𝑡 𝒊 + cos 𝑡 𝒋 , - 𝜋
2 <= 𝑡 <= 𝜋
2
2. 𝒓 𝑡 = 𝑡 2 - 𝑡2 𝒊 + (1 - t2) 𝒋, -1 <= 𝑡 <= 1
are both parametrizations of the unit circle
𝑥2 + 𝑦2 = 1
Example
The ellipse 𝑥2
𝑎2 + 𝑦2
𝑏2 = 1 can be parametrized
as 𝑎 cos 𝑡, 𝑏 sin 𝑡 for - 𝜋
2 <= 𝑡 <= 𝜋
2. Propose a
parametrization for the ellipsoid
𝑥2
𝑎2 + 𝑦2
𝑏2 + 𝑧2
𝑐2 = 1
Question 3

## Page 8

Parametrizing
➢ Time can be used as a parameter to describe a
surface, curve: for a <= 𝑡 <= 𝑏,
𝒓 𝑡 = 𝑥 𝑡 𝒊 + 𝑦 𝑡 𝒋 + 𝑧 𝑡 𝒌
➢ Parametrization is not necessarily unique
➢ There can be more than 1 parameter (if you need to
describe a surface for example)
➢ Can be closed (𝒓 𝑎 = 𝒓 𝑏 ) or open curves
➢ Can even be self intersecting
Find a parametrization of the
red curve on the right.
Question 4

## Page 9

Arc length
➢ Arc length for the curve 𝒓 𝑡 where 𝑎 <= 𝑡 <= 𝑏
𝑠 = න
𝑎
𝑏 𝑑𝒓
𝑑𝑡 𝑑𝑡 = න
𝑎
𝑏
𝑣 𝑡 𝑑𝑡
➢ The arc length is independent of the parametrization
➢ The length of the curve 𝒓 𝑥 = 𝑥 𝒊 + 𝑓 𝑥 𝒋 for 𝑎 <= 𝑥 <= 𝑏,
𝑠 = න
𝑎
𝑏
1 + 𝑓′ 𝑥 2 𝑑𝑥
➢ The length of the curve (polar coordinates) 𝑟 = 𝑔 𝜃 for 𝑎 <= 𝜃 <= 𝑏,
𝑠 = න
𝑎
𝑏
𝑔 𝜃 2 + 𝑔′ 𝜃 2 𝑑𝜃
What is the length the
ant travels while going
around the cylinder
once.
Questions 5

## Page 10

Arc length parametrization
➢ Piecewise smooth curves: if the curve is piece-wise
smooth then take the piece-wise sum or arc-lengths
➢ Arc length parametrization: The arc length between two
point is parameter independent. Hence, the most natural
(intrinsic) parametrization is when you parametrize the
curve based on the arc length 𝑠. For a curve 𝒓(𝑡), let
𝑠 𝑡, 0 = 𝐿(𝑡)
Then 𝒓 𝑠 = 𝒓(𝐿-1(𝑠)) is its intrinsic parametrization 1. Parametrize the ant's position in terms of
the arc length.
2. What is arc length parametrization
corresponding to Question 1.1?
Questions 6
