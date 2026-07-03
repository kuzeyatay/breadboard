---
title: "Mathematics 2 - Lec 12"
date: "2026-06-04T10:51:37.829Z"
source: "upload"
knowledge_type: "source-document"
source_type: "pdf"
source_file: "Mathematics 2 - Lec 12.pdf"
generated_by: "chatmock"
topics: []
tags: ["mathematics-lec", "lec", "mathematics"]
source_pdf: "/math-2/assets/mathematics-2-lec-12-source.pdf"
---

## Summary

[[Page 1]]
Mathematics 2
(5EZB0)
Lecture 12
Koondi Mitra
Mathematics & Computer Science Department

[[Page 2]]
Different line integrals
➢ If 𝒞 is closed, then the line integral is called the circulation
ර
𝒞
𝒇 𝒓 ⋅ 𝑑𝒓
➢ Consider the parametric curve 𝒞 (parameter a ≤ 𝑡 ≤ 𝑏) in 𝒟:
𝒓 𝑡 = 𝑥 �

## Knowledge tree

- No knowledge topics were extracted.

## Source material

## Page 1

Mathematics 2
(5EZB0)
Lecture 12
Koondi Mitra
Mathematics & Computer Science Department

## Page 2

Different line integrals
➢ If 𝒞 is closed, then the line integral is called the circulation
ර
𝒞
𝒇 𝒓 ⋅ 𝑑𝒓
➢ Consider the parametric curve 𝒞 (parameter a <= 𝑡 <= 𝑏) in 𝒟:
𝒓 𝑡 = 𝑥 𝑡 Ƹ	 𝒊 + 𝑦 𝑡 Ƹ	 𝒋 + 𝑧 𝑡 ෡	𝒌
➢ Consider the scalar and vector fields, 𝑓: 𝒟 -> ℝ, and 𝒇: 𝒟 -> ℝ𝑑
Then,
න
𝒞
𝒇 𝒓 ⋅ 𝑑𝒓 = න
𝑎
𝑏
𝒇 𝒓 𝑡 ⋅ 𝑑𝒓
𝑑𝑡 𝑑𝑡
න
𝒞
𝑓 𝒓(𝑡) 𝑑𝑠 = න
𝑎
𝑏
𝑓 𝒓 𝑡 𝑑𝒓
𝑑𝑡 𝑑𝑡
Line integral
Consider the field
𝒇 𝑥, 𝑦 = -𝑦 Ƹ	 𝒊 + 𝑥 Ƹ	 𝒋
𝑥2 + 𝑦2 .
Find ׯ𝒞 𝒇 𝒓 ⋅ 𝑑𝒓 along the following
curves 𝒞:
1. The circle 𝑥2 + 𝑦2 = 2
counterclockwise from 1, -1 .
2. The square -1,1 x -1,1
counterclockwise from 1, -1 .
Question 1

## Page 3

Conservative field
A domain 𝒟 is said to be connected if
every pair of points 𝑷 and 𝑸 can be joined
by a piecewise smooth curve lying in 𝒟.
Connected domains
A connected domain 𝒟 in which every
simple closed curve can be shrunk
continuously to a point in 𝒟 without
ever passing out of 𝒟.
Simply connected domains
There exists two points which cannot be
joined by a curve lying entirely in 𝒟
disconnected domains

## Page 4

Conservative field theorem
Let 𝑑 ∈ 2,3 , and 𝒟 ⊂ ℝ𝑑 be simply connected, and 𝒇: 𝒟 -> ℝ𝑑 be a
continuously differentiable field. Then the following statements are
equivalent
a) 𝒇 is a conservative field, i.e., 𝒇 = ∇𝜑.
b) the integral ׬𝒞 𝒇 𝒓 ⋅ 𝑑𝒓 only depends on the endpoints of 𝒞
.
c) The integral ׯ𝒞 𝒇 𝒓 ⋅ 𝑑𝒓 = 0 for all closed 𝒞
d) for all 1 <= 𝑖, 𝑗 <= 𝑑,
𝜕𝑓𝑖
𝜕𝑥𝑗
= 𝜕𝑓𝑗
𝜕𝑥𝑖
.
In other words, 𝐷𝒇 is symmetric, or ∇ x 𝒇 = 𝟎
Conservative Field Theorem
➢ Let 𝒇 = ∇𝜑: 𝒟 -> ℝ𝑑 be a conservative field. Then, along a curve
𝒞 connecting 𝒓(𝑎) = 𝑷 and 𝒓(𝑏) = 𝑸 and entirely belonging in 𝒟:
න
𝒞
𝒇 𝒓 ⋅ 𝑑𝒓 = 𝜑 𝑸 - 𝜑 𝑷 ,
Show that 𝒇 in Question 1 can be
written as ∇𝜑 and satisfies (d).
Does it satisfy (c)?
Justify your observations.
Question 2

## Page 5

Parametric surfaces
Let a point at a surface point be described by
𝒓 𝑢, 𝑣 = 𝑥 𝑢, 𝑣 Ƹ	 𝒊 + 𝑦 𝑢, 𝑣 Ƹ	 𝒋 + 𝑧 𝑢, 𝑣 ෡	𝒌
Parametric surfaces
➢ The graph of a function 𝑧 = 𝑓 𝑥, 𝑦 can be
parametrically described by
𝒓 𝑥, 𝑦 = 𝑥 Ƹ	 𝒊 + 𝑦 Ƹ	 𝒋 + 𝑓 𝑥, 𝑦 ෡	𝒌
➢ The ellipse 𝑥
𝑎
2
+ 𝑦
𝑏
2
+ 𝑧
𝑐
2
= 1:
𝒓 𝑢, 𝑣 = 𝑎 cos 𝑢 sin 𝑣 Ƹ	 𝒊 + 𝑏 sin 𝑢 sin 𝑣 Ƹ	 𝒋 + 𝑐 cos 𝑣 ෡	𝒌
for 0 <= 𝑢 <= 2𝜋, 0 <= 𝑣 <= 𝜋.
➢ One half of hyperboloid 𝑥
𝑎
2
+ 𝑦
𝑏
2
= 𝑧
𝑐
2
- 1:
𝒓 𝑢, 𝑣 = 𝑎 𝑣 cos 𝑢 Ƹ	 𝒊 + 𝑏 𝑣 sin 𝑢 Ƹ	 𝒋 + 𝑐 1 + 𝑣2 ෡	𝒌
for 0 <= 𝑢 <= 2𝜋, 𝑣 >= 0. Can you find some other
parametrization of the above?
Examples
More complicated surfaces can be
described compared to only graphs
Run Helicoid.py to observe the
surface of a helicoid
(𝑢 cos 𝑣, 𝑢 sin 𝑣 , 𝑣)

## Page 6

Surface integral
➢ Let 𝒓 𝑢, 𝑣 = 𝑥 𝑢, 𝑣 Ƹ	 𝒊 + 𝑦 𝑢, 𝑣 Ƹ	 𝒋 + 𝑧 𝑢, 𝑣 ෡	𝒌 describe a parametric
surface 𝒮 for 𝑢, 𝑣 ∈ 𝒟. Let 𝑓: ℝ3 -> ℝ be a continuous function.
➢ The surface integral is interpreted using the Riemann sums, as before
➢ The infinitesimal area element spanned by changing 𝑢 to 𝑢 + 𝑑𝑢, and
𝑣 to 𝑣 + 𝑑𝑣 has area
𝑑𝑆 = 𝜕𝒓
𝜕𝑢 x 𝜕𝒓
𝜕𝑣 𝑑𝑢𝑑𝑣
where 𝜕𝒓
𝜕𝑢 x 𝜕𝒓
𝜕𝑣 = det
Ƹ
𝒊 Ƹ	 𝒋 ෡	𝒌
𝜕𝑥
𝜕𝑢
𝜕𝑦
𝜕𝑢
𝜕𝑧
𝜕𝑢
𝜕𝑥
𝜕𝑣
𝜕𝑦
𝜕𝑣
𝜕𝑧
𝜕𝑣
= 𝜕(𝑦,𝑧)
𝜕(𝑢,𝑣) Ƹ 𝒊 + 𝜕(𝑧,𝑥)
𝜕(𝑢,𝑣) Ƹ 𝒋 + 𝜕(𝑥,𝑦)
𝜕(𝑢,𝑣) ෡	𝒌
➢ The surface integral of 𝑓 is then
න න
𝒮
𝑓 𝑥, 𝑦, 𝑧 𝑑𝑆 = න න
𝒟
𝑓 𝒓(𝑢, 𝑣) 𝜕𝒓
𝜕𝑢 x 𝜕𝒓
𝜕𝑣 𝑑𝑢𝑑𝑣

## Page 7

Surface integral
➢ Let 𝒓 𝑢, 𝑣 = 𝑥 𝑢, 𝑣 Ƹ	 𝒊 + 𝑦 𝑢, 𝑣 Ƹ	 𝒋 + 𝑧 𝑢, 𝑣 ෡	𝒌 describe a parametric
surface 𝒮 for 𝑢, 𝑣 ∈ 𝒟. Let 𝑓: ℝ3 -> ℝ be a continuous function.
➢ The surface integral of 𝑓 is then
න න
𝒮
𝑓 𝑥, 𝑦, 𝑧 𝑑𝑆 = න න
𝒟
𝑓 𝒓(𝑢, 𝑣) 𝜕𝒓
𝜕𝑢 x 𝜕𝒓
𝜕𝑣 𝑑𝑢𝑑𝑣
where 𝜕𝒓
𝜕𝑢 x 𝜕𝒓
𝜕𝑣 = det
Ƹ
𝒊 Ƹ	 𝒋 ෡	𝒌
𝜕𝑥
𝜕𝑢
𝜕𝑦
𝜕𝑢
𝜕𝑧
𝜕𝑢
𝜕𝑥
𝜕𝑣
𝜕𝑦
𝜕𝑣
𝜕𝑧
𝜕𝑣
= 𝜕(𝑦,𝑧)
𝜕(𝑢,𝑣) Ƹ 𝒊 + 𝜕(𝑧,𝑥)
𝜕(𝑢,𝑣) Ƹ 𝒋 + 𝜕(𝑥,𝑦)
𝜕(𝑢,𝑣) ෡	𝒌.
➢ To find the area of 𝒮, put 𝑓 = 1
➢ The formula of area coincides with the formula derived before of surface
area of a graph 𝒓 𝑥, 𝑦 = 𝑥 Ƹ	 𝒊 + 𝑦 Ƹ	 𝒋 + 𝑓 𝑥, 𝑦 ෡	𝒌,
𝒮 = න න
𝒟
1 + ∇𝑓(𝑥, 𝑦) 2 𝑑𝑥𝑑𝑦
Remark

## Page 8

Surface integral
➢ Let 𝒓 𝑢, 𝑣 = 𝑥 𝑢, 𝑣 Ƹ	 𝒊 + 𝑦 𝑢, 𝑣 Ƹ	 𝒋 + 𝑧 𝑢, 𝑣 ෡	𝒌 describe a parametric
surface 𝒮 for 𝑢, 𝑣 ∈ 𝒟. Let 𝑓: ℝ3 -> ℝ be a continuous function.
➢ The surface integral of 𝑓 is then
න න
𝒮
𝑓 𝑥, 𝑦, 𝑧 𝑑𝑆 = න න
𝒟
𝑓 𝒓(𝑢, 𝑣) 𝜕𝒓
𝜕𝑢 x 𝜕𝒓
𝜕𝑣 𝑑𝑢𝑑𝑣
where 𝜕𝒓
𝜕𝑢 x 𝜕𝒓
𝜕𝑣 = det
Ƹ
𝒊 Ƹ	 𝒋 ෡	𝒌
𝜕𝑥
𝜕𝑢
𝜕𝑦
𝜕𝑢
𝜕𝑧
𝜕𝑢
𝜕𝑥
𝜕𝑣
𝜕𝑦
𝜕𝑣
𝜕𝑧
𝜕𝑣
= 𝜕(𝑦,𝑧)
𝜕(𝑢,𝑣) Ƹ 𝒊 + 𝜕(𝑧,𝑥)
𝜕(𝑢,𝑣) Ƹ 𝒋 + 𝜕(𝑥,𝑦)
𝜕(𝑢,𝑣) ෡	𝒌.
The moment of inertia of a uniform
spherical shell:
𝒮 = {𝑥2 + 𝑦2 + 𝑧2 = 𝑎2}
න න
𝒮
𝑥2 + 𝑦2 𝑑𝑆
Question 3.1
Find the area of the part of
the cylinder 𝑥2 + 𝑦2 = 2𝑎𝑦,
that lies inside the sphere
𝑥2 + 𝑦2 + 𝑧2 = 4𝑎2
Question 3.2

## Page 9

Oriented surfaces
A smooth surface 𝒮 is orientable if there exists a
unit normal field ෢	𝑵: 𝒮 -> ℝ3 such that for any 𝑷 ∈ 𝒮,
෡	𝑵(𝑷) varies continuously with 𝑷. The field ෡	𝑵 is
called an orientation.
The side which points along ෡	𝑵 𝑷 is called the
positive side, the other side is negative side.
Oriented surfaces
➢ An oriented surface 𝒮 induces an orientation on any of
its boundary curves 𝒞 (clockwise and counter-clockwise)
➢ piecewise smooth surface is orientable if, whenever two
smooth component surfaces join along a common
boundary curve 𝒞, they induce opposite orientations
A piecewise smooth
orientable surface: Cube A non-orientable surface:
The Möbius strip
Source: Wikipedia.org

## Page 10

Oriented surfaces
A smooth surface 𝒮 is orientable if there exists a
unit normal field ෢	𝑵: 𝒮 -> ℝ𝑑 such that for any 𝑷 ∈
𝒮, ෡	𝑵(𝑷) varies continuously with 𝑷. The field ෡	𝑵 is
called an orientation.
The side which points along ෡	𝑵 𝑷 is called the
positive side, the other side is negative side.
Oriented surfaces
➢ For a parametric surface 𝒓 𝑢, 𝑣 :
෡	𝑵 𝒓 𝑢, 𝑣 =
𝜕𝒓
𝜕𝑢 x 𝜕𝒓
𝜕𝑣
𝜕𝒓
𝜕𝑢 x 𝜕𝒓
𝜕𝑣
➢ For a graph 𝑧 = 𝑓 𝑥, 𝑦
෡	𝑵 𝒓 𝑢, 𝑣 = -∇𝑓 + ෡	𝒌
1 + 𝛻𝑓 2

## Page 11

Flux integrals
➢ Let 𝒓 𝑢, 𝑣 = 𝑥 𝑢, 𝑣 Ƹ	 𝒊 + 𝑦 𝑢, 𝑣 Ƹ	 𝒋 + 𝑧 𝑢, 𝑣 ෡	𝒌 describe an
orientable surface for 𝑢, 𝑣 ∈ 𝒟.
➢ Let ෡	𝑵: 𝒮 -> ℝ3be the orientation
➢ Let 𝒇: 𝒟 -> ℝ3be a vector field
➢ The vector surface area element is defined as
𝑑𝑺 = ෡	𝑵𝑑𝑆 = 𝜕𝒓
𝜕𝑢 x 𝜕𝒓
𝜕𝑣 𝑑𝑢𝑑𝑣
➢ Then, the flux integral is
න න
𝒮
𝒇 ⋅ 𝑑𝑺 = න න
𝒟
𝒇 𝒓(𝑢, 𝑣) ⋅ 𝜕𝒓
𝜕𝑢 x 𝜕𝒓
𝜕𝑣 𝑑𝑢𝑑𝑣
➢ If 𝒮 is a closed surface, then the integral is written as
඾
𝒮
𝒇 ⋅ 𝑑𝑺
For the gravitational field
𝑭 = - 𝐶𝒓
𝒓 𝟑
find the flux integral over the unit sphere.
Question 4
