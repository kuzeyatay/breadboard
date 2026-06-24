---
title: "Mathematics 2 - Lec 11"
date: "2026-06-04T10:51:39.384Z"
source: "upload"
knowledge_type: "source-document"
source_type: "pdf"
source_file: "Mathematics 2 - Lec 11.pdf"
generated_by: "chatmock"
topics: []
tags: ["mathematics-lec", "lec", "mathematics"]
source_pdf: "/math-2/assets/mathematics-2-lec-11-source.pdf"
---

## Summary

[[Page 1]]
Mathematics 2
(5EZB0)
Lecture 11
Koondi Mitra
Mathematics & Computer Science
Department
This Photo by Unknown Author is licensed under CC BY-NC

[[Page 2]]
Conservative fields
If 𝒇: = (𝑓1, 𝑓2, . . , 𝑓𝑑) = ∇𝜑, for some function 𝜑: 𝒟 → ℝ, then we call 𝒇
a conservative field and 𝜑 

## Knowledge tree

- No knowledge topics were extracted.

## Source material

## Page 1

Mathematics 2
(5EZB0)
Lecture 11
Koondi Mitra
Mathematics & Computer Science
Department
This Photo by Unknown Author is licensed under CC BY-NC

## Page 2

Conservative fields
If 𝒇: = (𝑓1, 𝑓2, . . , 𝑓𝑑) = ∇𝜑, for some function 𝜑: 𝒟 -> ℝ, then we call 𝒇
a conservative field and 𝜑 a scalar potential.
Conservative field
➢ Gravitational, electric, magnetic fields are all conservative.
➢ For 𝑛 different masses/charges 𝑞𝑖 at 𝒙𝑖, the potential is
𝜑 = ෍
𝑖=1
𝑛 𝐶𝑞𝑖
𝒙 - 𝒙𝑖
, 𝒇 = - ෍
𝑖=1
𝑛 𝐶𝑞𝑖(𝒙 - 𝒙𝑖 )
𝒙 - 𝒙𝑖 3
Examples
➢ They are conservative because the energy integral ׯ 𝒇 ⋅ 𝑑𝒓 = 0 over
any closed loop in 𝒟 (to be understood in a later context)
For a conservative field 𝒇 =
∇𝜑, with potential 𝜑: 𝒟 ->
ℝ, the level-sets of 𝜑 are
called equipotential
surfaces.
Equipotential surfaces
Show that for a conservative field 𝒇: 𝒟 -> ℝ, the equipotential surfaces and the
field lines are perpendicular to each other.
Question 1

## Page 3

Conservative fields
If 𝒇 = ∇𝜑, for some function 𝜑: 𝒟 -> ℝ, then we call 𝒇 a conservative
field and 𝜑 a scalar potential.
Conservative field
Let 𝑑 ∈ 2,3 , and 𝒟 ⊂ ℝ𝑑 be simply connected. Then a differentiable
field 𝒇: 𝒟 -> ℝ𝑑 is conservative if and only if for all 1 <= 𝑖, 𝑗 <= 𝑑,
𝜕𝑓𝑖
𝜕𝑥𝑗
= 𝜕𝑓𝑗
𝜕𝑥𝑖
;
in other words, if 𝐷𝒇 is symmetric.
Theorem
Is the following field conservative? If so, then what is the potential and
equipotential surfaces:
𝒇 𝒙 = 𝒙 - 𝑎 Ƹ 𝒊
𝒙 - 𝑎 Ƹ 𝒊 + 𝒙 + 𝑎 Ƹ 𝒊
𝒙 + 𝑎 Ƹ 𝒊
Question 2

## Page 4

Line integrals of vector fields
➢ Consider the parametric curve 𝒞 (parameter a <= 𝑡 <= 𝑏) in 𝒟:
𝒓 𝑡 = 𝑥 𝑡 Ƹ	 𝒊 + 𝑦 𝑡 Ƹ	 𝒋 + 𝑧 𝑡 ෡	𝒌
➢ Consider the vector field 𝒇: 𝒟 -> ℝ𝑑
➢ Let 𝑎 = 𝑡0 < 𝑡1 < 𝑡2 < ⋯ < 𝑡𝑛 = 𝑏 with Δ𝑡 = max |𝑡𝑖 - 𝑡𝑖-1|, and the
Riemann rum
෍
𝑖=1
𝑛
𝒇 𝒓 𝑡𝑖
∗ ⋅ 𝒓 𝑡𝑖 - 𝒓 𝑡𝑖-1 , 𝑡𝑖
∗ ∈ 𝑡𝑖-1, 𝑡𝑖 .
Courtesy: activecalculus.org/
න
𝒞
𝒇 𝒓 ⋅ 𝑑𝒓 = න
𝒞
෍
𝑖
𝑑
𝑓𝑖 𝒓 𝑑𝑥𝑖
1
= lim
Δ𝑡->0 ෍
𝑖=1
𝑛
𝒇 𝒓 𝑡𝑖
∗ ⋅ 𝒓 𝑡𝑖 - 𝒓 𝑡𝑖-1 = න
𝑎
𝑏
𝒇 𝒓 𝑡 ⋅ 𝑑𝒓
𝑑𝑡 𝑑𝑡
Line integral

## Page 5

Line integrals of vector fields
➢ Consider the parametric curve 𝒞 (parameter a <= 𝑡 <= 𝑏) in 𝒟:
𝒓 𝑡 = 𝑥 𝑡 Ƹ	 𝒊 + 𝑦 𝑡 Ƹ	 𝒋 + 𝑧 𝑡 ෡	𝒌
➢ Consider the vector field 𝒇: 𝒟 -> ℝ𝑑
➢ Let 𝑎 = 𝑡0 < 𝑡1 < 𝑡2 < ⋯ < 𝑡𝑛 = 𝑏 with Δ𝑡 = max |𝑡𝑖 - 𝑡𝑖-1|, and the
Riemann rum
෍
𝑖=1
𝑛
𝒇 𝒓 𝑡𝑖
∗ ⋅ 𝒓 𝑡𝑖 - 𝒓 𝑡𝑖-1 , 𝑡𝑖
∗ ∈ 𝑡𝑖-1, 𝑡𝑖 .
න
𝒞
𝒇 𝒓 ⋅ 𝑑𝒓 = න
𝒞
෍
𝑖
𝑑
𝑓𝑖 𝒓 𝑑𝑥𝑖
1
= lim
Δ𝑡->0 ෍
𝑖=1
𝑛
𝒇 𝒓 𝑡𝑖
∗ ⋅ 𝒓 𝑡𝑖 - 𝒓 𝑡𝑖-1 = න
𝑎
𝑏
𝒇 𝒓 𝑡 ⋅ 𝑑𝒓
𝑑𝑡 𝑑𝑡
Line integral
Run line_integral.m to see how for
an arbitrary vector field and curve the
Riemann sum converges to the line
integral

## Page 6

Line integrals of vector fields
➢ Does not depend on the
parametrization chosen: for
reparametrization 𝑡 ↦ 𝑠,
∫ 𝒇 𝒓 𝑡 ⋅ 𝑑𝒓
𝑑𝑡 𝑑𝑡
= ∫ 𝒇 𝒓 𝑠 ⋅ 𝑑𝒓
𝑑𝑠
𝑑𝑠
𝑑𝑡 𝑑𝑡
= ∫ 𝒇 𝒓 𝑠 ⋅ 𝑑𝒓
𝑑𝑠 𝑑𝑠
Notes
➢ Consider the parametric curve 𝒞 (parameter a <= 𝑡 <= 𝑏) in 𝒟:
𝒓 𝑡 = 𝑥 𝑡 Ƹ	 𝒊 + 𝑦 𝑡 Ƹ	 𝒋 + 𝑧 𝑡 ෡	𝒌
➢ Consider the vector field 𝒇: 𝒟 -> ℝ𝑑
➢ Let 𝑎 = 𝑡0 < 𝑡1 < 𝑡2 < ⋯ < 𝑡𝑛 = 𝑏 with Δ𝑡 = max |𝑡𝑖 - 𝑡𝑖-1|, and the
Riemann rum
෍
𝑖=1
𝑛
𝒇 𝒓 𝑡𝑖
∗ ⋅ 𝒓 𝑡𝑖 - 𝒓 𝑡𝑖-1 , 𝑡𝑖
∗ ∈ 𝑡𝑖-1, 𝑡𝑖 .
න
𝒞
𝒇 𝒓 ⋅ 𝑑𝒓 = න
𝒞
෍
𝑖
𝑑
𝑓𝑖 𝒓 𝑑𝑥𝑖
1
= lim
Δ𝑡->0 ෍
𝑖=1
𝑛
𝒇 𝒓 𝑡𝑖
∗ ⋅ 𝒓 𝑡𝑖 - 𝒓 𝑡𝑖-1 = න
𝑎
𝑏
𝒇 𝒓 𝑡 ⋅ 𝑑𝒓
𝑑𝑡 𝑑𝑡
Line integral

## Page 7

Line integrals of scalar fields
➢ Consider the parametric curve 𝒞 (parameter a <= 𝑡 <= 𝑏) in 𝒟:
𝒓 𝑡 = 𝑥 𝑡 Ƹ	 𝒊 + 𝑦 𝑡 Ƹ	 𝒋 + 𝑧 𝑡 ෡	𝒌
➢ Consider the scalar field 𝑓: 𝒟 -> ℝ
➢ Let 𝑎 = 𝑡0 < 𝑡1 < 𝑡2 < ⋯ < 𝑡𝑛 = 𝑏 with Δ𝑡 = max |𝑡𝑖 - 𝑡𝑖-1|, and the
Riemann rum
෍
𝑖=1
𝑛
𝑓 𝒓 𝑡𝑖
∗ |𝒓 𝑡𝑖 - 𝒓 𝑡𝑖-1 |, 𝑡𝑖
∗ ∈ 𝑡𝑖-1, 𝑡𝑖 .
Let 𝑠 be the intrinsic (arc-length) parametrization of 𝒞. Then
න
𝒞
𝑓 𝒓(𝑠) 𝑑𝑠 = lim
Δ𝑡->0 ෍
𝑖=1
𝑛
𝑓 𝒓 𝑡𝑖
∗ |𝒓 𝑡𝑖 - 𝒓 𝑡𝑖-1 |
= න
𝑎
𝑏
𝑓 𝒓 𝑡 𝑑𝒓
𝑑𝑡 𝑑𝑡
Line integral
➢ Does not depend on
parametrization as before.
➢ To compute the length of a curve
𝒞 is to simply set 𝑓 = 1, i.e., the
arc-length is ∫𝒞 𝑑𝑠
Notes

## Page 8

Different line integrals
➢ If 𝒞 is closed, then the line integral is called the circulation
ර
𝒞
𝒇 𝒓 ⋅ 𝑑𝒓
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
Find the following line integrals
1. ∫𝒞 𝑧 𝑑𝑠
for the conical helix
(𝑡 cos 𝑡, 𝑡 sin 𝑡, 𝑡)
if 0 < 𝑡 <
2𝜋
, i.e., its 𝑧
-centroid
2. Example 4 in Ch 16.3
Question 3.1
Find the line integral of 𝒇 = 𝑥2 Ƹ 𝒊 - 𝑦 Ƹ 𝒋
along
the following curves 𝒞
connecting 0,0
and
1,1
1. 𝒞
is composed of the line {𝑥 = 0,0 <=
𝑦 <= 1}
and the line 0 <= 𝑥 <= 1, 𝑦 = 1 .
2. 𝒞
is the curve {0 <= 𝑥 <= 1, 𝑦 = 𝑥2}
What do you notice?
Question 3.2

## Page 9

Conservative field
➢ If 𝒇 is a conservative force, then the integral is called the work
Let 𝒇 = ∇𝜑 be a conservative field. Then along a curve 𝒞 connecting
𝒓(𝑎) = 𝑷 and 𝒓(𝑏) = 𝑸 and entirely belonging in 𝒟:
න
𝒞
𝒇 𝒓 ⋅ 𝑑𝒓 = 𝜑 𝑸 - 𝜑 𝑷 ,
Implying that
ර
𝒞
𝒇 𝒓 ⋅ 𝑑𝒓 = 0
Line integral of conservative fields
For motion following the Newton's law,
m d2𝐫
dt2 = 𝐟 𝐫 t
show the conservation of energy ℰ = 1
2 𝑚 𝑑𝒓
𝑑𝑡
2
- 𝜑(𝒓)
Question 3.1
Show that if ׯ𝒞 𝒇 𝒓 ⋅ 𝑑𝒓 = 0 for all closed curves 𝒞 for
some vector field 𝒇, then value of any line integral only
depends on the end-points.
Question 3.2
Courtesy: Wikipedia.org

## Page 10

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

## Page 11

Conservative field theorem
Let 𝑑 ∈ 2,3 , and 𝒟 ⊂ ℝ𝑑 be simply connected, and 𝒇: 𝒟 -> ℝ𝑑 be a
continuously differentiable field. Then the following statements are
equivalent
a) 𝒇 is conservative, i.e., 𝒇 = ∇𝜑.
b) the integral ∫𝒞 𝒇 𝒓 ⋅ 𝑑𝒓 only depends on the endpoints of 𝒞
c) The integral ׯ𝒞 𝒇 𝒓 ⋅ 𝑑𝒓 = 0 for all closed 𝒞
d) for all 1 <= 𝑖, 𝑗 <= 𝑑,
𝜕𝑓𝑖
𝜕𝑥𝑗
= 𝜕𝑓𝑗
𝜕𝑥𝑖
.
In other words, 𝐷𝒇 is symmetric, or ∇ x 𝒇 = 𝟎
Conservative Field Theorem
Consider the rotational field
𝒇 𝑥, 𝑦 = 𝜔 -𝑦 Ƹ	 𝒊 + 𝑥 Ƹ	 𝒋 = 𝜔 ෡	𝒌 x 𝒓.
Show that none of the conditions above are satisfied.
Question 4
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
Next class- Flux integrals
