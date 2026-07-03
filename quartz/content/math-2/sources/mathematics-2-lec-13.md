---
title: "Mathematics 2 - Lec 13"
date: "2026-06-04T10:51:35.995Z"
source: "upload"
knowledge_type: "source-document"
source_type: "pdf"
source_file: "Mathematics 2 - Lec 13.pdf"
generated_by: "chatmock"
topics: []
tags: ["mathematics-lec", "lec", "mathematics"]
source_pdf: "/math-2/assets/mathematics-2-lec-13-source.pdf"
---

## Summary

[[Page 1]]
Mathematics 2
(5EZB0)
Lecture 13
Koondi Mitra
Mathematics & Computer Science Department
This Photo by Unknown Author is licensed under CC BY

[[Page 2]]
Surface integral
➢ Let 𝒓 𝑢, 𝑣 = 𝑥 𝑢, 𝑣 Ƹ	 𝒊 + 𝑦 𝑢, 𝑣 Ƹ	 𝒋 + 𝑧 𝑢, 𝑣 ෡	𝒌 describe a parametric
surface 𝒮 for 𝑢, 𝑣 ∈ 𝒟. 

## Knowledge tree

- No knowledge topics were extracted.

## Source material

## Page 1

Mathematics 2
(5EZB0)
Lecture 13
Koondi Mitra
Mathematics & Computer Science Department
This Photo by Unknown Author is licensed under CC BY

## Page 2

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

## Page 3

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

## Page 4

Oriented surfaces
A smooth surface 𝒮 is orientable if there exists a
unit normal field ෢	𝑵: 𝒮 -> ℝ𝑑 such that for any 𝑷 ∈
𝒮, ෡	𝑵(𝑷) varies continuously with 𝑷. The field ෡	𝑵 is
called an orientation.
The side which points along ෡	𝑵 𝑷 is called the
positive side, the other side is negative side.
Oriented surfaces
➢ For a parametric surface 𝒓 𝑢, 𝑣 :
෡	𝑵 𝒓 𝑢, 𝑣 = ±
𝜕𝒓
𝜕𝑢 x 𝜕𝒓
𝜕𝑣
𝜕𝒓
𝜕𝑢 x 𝜕𝒓
𝜕𝑣
➢ For a graph 𝑧 = 𝑓 𝑥, 𝑦
෡	𝑵 𝒓 𝑢, 𝑣 = ± -∇𝑓 + ෡	𝒌
1 + 𝛻𝑓 2
Are the following surfaces
orientable?
1. Torus
2. A cone
Question 1

## Page 5

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
𝑭 = - 𝐶𝑞𝒓
𝒓 𝟑
find the flux integral over
the surface of the
1. the unit sphere.
2. The cube -𝑎, 𝑎 3
Question 2.1
The flow across the surface
of a sieve 𝑧 = 1 - 𝑥2 - 𝑦2
for 𝑧 >= 0, under the helical
vortex
𝒇 = - 𝑦 Ƹ	 𝒊 + 𝑥 Ƹ	 𝒋 + ෡	𝒌
Question 2.2

## Page 6

Gradient, Divergence, and Curl
Let 𝒟 ⊆ ℝ3. For 𝑓: 𝒟 -> ℝ:
𝐠𝐫𝐚𝐝 𝑓 = ∇𝑓 = 𝜕𝑓
𝜕𝑥 Ƹ 𝒊 + 𝜕𝑓
𝜕𝑦 Ƹ 𝒋 + 𝜕𝑓
𝜕𝑧 ෡	𝒌
Gradient
For 𝒇: 𝒟 -> ℝ3:
𝐝𝐢𝐯 𝒇 = ∇ ⋅ 𝒇 = 𝜕𝑓1
𝜕𝑥 + 𝜕𝑓2
𝜕𝑦 + 𝜕𝑓3
𝜕𝑧
Divergence
For 𝒇: 𝒟 -> ℝ3:
𝐜𝐮𝐫𝐥 𝒇 = 𝐫𝐨𝐭(𝒇) = ∇ x 𝒇
= 𝜕𝑓3
𝜕𝑦 - 𝜕𝑓2
𝜕𝑧 Ƹ 𝒊 + 𝜕𝑓1
𝜕𝑧 - 𝜕𝑓3
𝜕𝑥 Ƹ 𝒋 + 𝜕𝑓2
𝜕𝑥 - 𝜕𝑓1
𝜕𝑦 ෡	𝒌
=
Ƹ
𝒊 Ƹ	 𝒋 ෡	𝒌
𝜕𝑥 𝜕𝑦 𝜕𝑧
𝑓1 𝑓2 𝑓3
Curl
∇ ⋅ 𝑬 = 𝜌
𝜀0
∇ ⋅ 𝑩 = 0
∇ x 𝑬 = - 𝜕𝑩
𝜕𝑡
∇ x 𝑩 = 𝜇0 𝑱 + 𝜀0
𝜕𝑬
𝜕𝑡
Maxwell's equations of Electromagnetism
𝜌 𝜕𝒖
𝜕𝑥 + 𝒖 ⋅ ∇𝒖 = -∇𝑝(𝜌) + 𝜇∇ ⋅ ∇𝒖 + 𝒇
𝜕𝜌
𝜕𝑡 + ∇ ⋅ 𝜌𝒖 = 0
Navier-Stokes equations of Fluid mechanics

## Page 7

Physical interpretation
For a flow field 𝒇: 𝒟 -> ℝ3:
𝐜𝐮𝐫𝐥 𝒇 = 𝐫𝐨𝐭(𝒇) = ∇ x 𝒇
represents the rotational density of the field.
Curl
For a closed surface 𝒮 enclosing a domain 𝒟:
඾
𝒮
𝒇 ⋅ 𝑑𝑺 = ම
𝒟
∇ ⋅ 𝒇 𝑑𝑉
The divergence theorem (Not in syllabus)
Watch a very nice
video on the
physical
interpretation:
youtube.com/watc
h?v=rB83DpBJQsE
For a flow field 𝒇: 𝒟 -> ℝ3:
𝐝𝐢𝐯 𝒇 = ∇ ⋅ 𝒇 = 𝜕𝑓1
𝜕𝑥 + 𝜕𝑓2
𝜕𝑦 + 𝜕𝑓3
𝜕𝑧
signifies how much flow is created per unit volume.
Divergence
For a smooth oriented surface 𝒮 with boundary 𝒞:
ර
𝒞
𝒇 ⋅ 𝑑𝒓 = ඵ
𝒮
(∇ x 𝒇) ⋅ 𝑑𝑺
Stokes' theorem (Not in syllabus)
1. For a rotational field 𝒇 = 𝝎 x 𝒓, we have
∇ x 𝒇 = 2𝝎
2. Curl of conservative field is 0
∇ x ∇𝑓 = 0
3. Divergence of curl is zero:
∇ ⋅ (∇ x 𝒇) = 0
Remarks

## Page 8

Gradient, Divergence, and Curl
Let 𝒟 ⊆ ℝ3. For 𝑓: 𝒟 -> ℝ:
𝐠𝐫𝐚𝐝 𝑓 = ∇𝑓 = 𝜕𝑓
𝜕𝑥 Ƹ 𝒊 + 𝜕𝑓
𝜕𝑦 Ƹ 𝒋 + 𝜕𝑓
𝜕𝑧 ෡	𝒌
Gradient
For 𝒇: 𝒟 -> ℝ3:
𝐝𝐢𝐯 𝒇 = ∇ ⋅ 𝒇 = 𝜕𝑓1
𝜕𝑥 + 𝜕𝑓2
𝜕𝑦 + 𝜕𝑓3
𝜕𝑧
Divergence
For 𝒇: 𝒟 -> ℝ3:
𝐜𝐮𝐫𝐥 𝒇 = 𝐫𝐨𝐭(𝒇) = ∇ x 𝒇
= 𝜕𝑓3
𝜕𝑦 - 𝜕𝑓2
𝜕𝑧 Ƹ 𝒊 + 𝜕𝑓1
𝜕𝑧 - 𝜕𝑓3
𝜕𝑥 Ƹ 𝒋 + 𝜕𝑓2
𝜕𝑥 - 𝜕𝑓1
𝜕𝑦 ෡	𝒌
=
Ƹ
𝒊 Ƹ	 𝒋 ෡	𝒌
𝜕𝑥 𝜕𝑦 𝜕𝑧
𝑓1 𝑓2 𝑓3
Curl
Find the div and curl of the
flow field
𝑭 = - 𝐶𝑞𝒓
𝒓 𝟑
Question 3.1
Study Example 6 in Chapter
17.1. What is the curl of the
vector field
𝒇 = 𝑥 Ƹ	 𝒋
Question 3.2

## Page 9

Gradient, Divergence, and Curl
Let 𝒟 ⊆ ℝ3. For 𝑓: 𝒟 -> ℝ:
𝐠𝐫𝐚𝐝 𝑓 = ∇𝑓 = 𝜕𝑓
𝜕𝑥 Ƹ 𝒊 + 𝜕𝑓
𝜕𝑦 Ƹ 𝒋 + 𝜕𝑓
𝜕𝑧 ෡	𝒌
Gradient
For 𝒇: 𝒟 -> ℝ3:
𝐝𝐢𝐯 𝒇 = ∇ ⋅ 𝒇 = 𝜕𝑓1
𝜕𝑥 + 𝜕𝑓2
𝜕𝑦 + 𝜕𝑓3
𝜕𝑧
Divergence
For 𝒇: 𝒟 -> ℝ3:
𝐜𝐮𝐫𝐥 𝒇 = 𝐫𝐨𝐭(𝒇) = ∇ x 𝒇
= 𝜕𝑓3
𝜕𝑦 - 𝜕𝑓2
𝜕𝑧 Ƹ 𝒊 + 𝜕𝑓1
𝜕𝑧 - 𝜕𝑓3
𝜕𝑥 Ƹ 𝒋 + 𝜕𝑓2
𝜕𝑥 - 𝜕𝑓1
𝜕𝑦 ෡	𝒌
=
Ƹ
𝒊 Ƹ	 𝒋 ෡	𝒌
𝜕𝑥 𝜕𝑦 𝜕𝑧
𝑓1 𝑓2 𝑓3
Curl
Product rule
(a) ∇ 𝜙𝜓 = 𝜙 ∇𝜓 + 𝜓 ∇𝜙
(b) ∇ ⋅ 𝜙𝒇 = ∇𝜙 ⋅ 𝒇 + 𝜙 ∇ ⋅ 𝒇
(c) ∇ x 𝜙𝒇 = ∇𝜙 x 𝒇 + 𝜙 ∇ x 𝒇
(d) ∇ ⋅ 𝒇 x 𝒈 = ∇ x 𝒇 ⋅ 𝒈 - 𝒇 ⋅ (∇ x 𝒈)
Second order derivatives
(a) ∇ x ∇𝑓 = 0
(b) ∇ ⋅ (∇ x 𝒇) = 0
(c) ∇ x ∇ x 𝒇 = ∇ ∇ ⋅ 𝒇 - ∇2𝒇
∇2𝑓 = ∇ ⋅ ∇𝑓 is called the Laplacian of 𝑓
More identities
Find the div and curl of the
vector field
𝒇(𝑟, 𝜃) = - sin 𝜃 Ƹ	 𝒊 + cos 𝜃 Ƹ	 𝒋
Question 4
