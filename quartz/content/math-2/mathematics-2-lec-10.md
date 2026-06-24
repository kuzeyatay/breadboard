---
title: "Mathematics 2 - Lec 10"
date: "2026-06-04T10:51:41.093Z"
source: "upload"
knowledge_type: "source-document"
source_type: "pdf"
source_file: "Mathematics 2 - Lec 10.pdf"
generated_by: "chatmock"
topics: []
tags: ["mathematics-lec", "lec", "mathematics"]
source_pdf: "/math-2/assets/mathematics-2-lec-10-source.pdf"
---

## Summary

[[Page 1]]
Mathematics 2
(5EZB0)
Lecture 10
Koondi Mitra
Mathematics & Computer Science
Department
This Photo by Unknown Author is licensed under CC BY-SA

[[Page 2]]
Change of variables
Now consider the change of variable
𝑥 = 𝑥 𝑢, 𝑣, 𝑤
𝑦 = 𝑦 𝑢, 𝑣, 𝑤
𝑧 = 𝑧 𝑢, 𝑣, 𝑤
➢ Let 𝑓 𝑥 𝑢, 𝑣, 

## Knowledge tree

- No knowledge topics were extracted.

## Source material

## Page 1

Mathematics 2
(5EZB0)
Lecture 10
Koondi Mitra
Mathematics & Computer Science
Department
This Photo by Unknown Author is licensed under CC BY-SA

## Page 2

Change of variables
Now consider the change of variable
𝑥 = 𝑥 𝑢, 𝑣, 𝑤
𝑦 = 𝑦 𝑢, 𝑣, 𝑤
𝑧 = 𝑧 𝑢, 𝑣, 𝑤
➢ Let 𝑓 𝑥 𝑢, 𝑣, 𝑤 , 𝑦 𝑢, 𝑣, 𝑤 , 𝑧 𝑢, 𝑣, 𝑤 = ℎ 𝑢, 𝑣, 𝑤
➢ Let the domain 𝒟 be transformed into 𝑆 in 𝑢, 𝑣, 𝑤 coordinates
න න න
𝒟
𝑓 𝑥, 𝑦, 𝑧 𝑑𝑥𝑑𝑦𝑑𝑧 = න න න
𝑆
ℎ 𝑢, 𝑣, 𝑤 det 𝜕(𝑥, 𝑦, 𝑧)
𝜕(𝑢, 𝑣, 𝑤) 𝑑𝑢𝑑𝑣𝑑𝑤
➢ 𝑥 = 𝑟 cos 𝜃, 𝑦 = 𝑟 sin 𝜃, 𝑧 = 𝑧
➢ det 𝜕(𝑥,𝑦,𝑧)
𝜕(𝑟,𝜃,𝑧) = 𝑟
Cylindrical Coordinates
➢ 𝑥 = 𝑅 sin 𝜙 cos 𝜃
, 𝑦 = 𝑅 sin 𝜙 sin 𝜃 , 𝑧 = 𝑅 cos 𝜙
➢ det 𝜕(𝑥,𝑦,𝑧)
𝜕(𝑅,𝜙,𝜃) = 𝑅2 sin 𝜙
Spherical Coordinates

## Page 3

Surface area
We saw earlier that a surface normal of 𝑧 = 𝑓 𝑥, 𝑦 is along
𝒏 = (∇𝑓(𝑥, 𝑦), -1)
➢ The angle with the 𝑧-axis is then cos 𝛾 = |𝒏⋅𝒌|
𝒏 |𝒌| = 1
1+ ∇𝑓 2
➢ The area of the surface element would be
𝑑𝒮 = 𝑑𝐴
cos 𝛾 = 1 + ∇𝑓 2 𝑑𝐴
➢ Then the surface area is
𝒮 = න න
𝒟
1 + ∇𝑓 2 𝑑𝐴
Find the surface area of a Torus with
major radius 𝑅, and minor radius b.
Question 1
The surface area of the function
𝑧 = 𝑓 𝑟 (𝑟 > 0) is 2𝜋 ׬0
∞ 𝑟 1 + 𝑓′ 𝑟 2 𝑑𝑟
Surface of revolution

## Page 4

Revisiting Scalar & Vector fields
For a domain 𝒟 ⊆ ℝ𝑑, a vector field 𝒇 is a function of the form
𝒇 𝒙 = (𝑓1 𝒙 , 𝑓2 𝒙 , ... , 𝑓𝑛 𝒙 )
written also as
𝒇: 𝒟 -> ℝ𝑛
Vector fields The vector field of
gravitational field
The vector field of rotating
object

## Page 5

Field lines
For the vector field 𝒇: 𝒟 -> ℝ𝑑 its field-lines/ steam-lines are family of
curves 𝒓 𝑡 = σ𝑖=1
𝑑 𝑥𝑖 ො	𝒆𝑥𝑖 described by parameter 𝑡, such that on any
point of the curve, the field 𝒇 is tangent to the curve. i.e.,
𝑑𝒓
𝑑𝑡 𝑡 = 𝜆 𝑡 𝒇(𝒓(𝑡))
Filed lines
This Photo by Unknown Author is licensed
under CC BY-SA
This yields the equation for all 1 <= 𝑖 <= 𝑑
𝑑𝑥𝑖
𝑓𝑖(𝒓) = 𝜆 𝑡 𝑑𝑡
What are the field lines of
1. The electric field of a point-charge?
2. A rotating object with angular
velocity 𝜔 (a rotational field)?
Question 2

## Page 6

Conservative fields
If 𝒇 = ∇𝜑, for some function 𝜑: 𝒟 -> ℝ, then we call 𝒇 a conservative
field and 𝜑 a scalar potential.
Conservative field
This Photo by Unknown Author is licensed
under CC BY-SA-NC
➢ Gravitational, electric, magnetic fields are all conservative.
➢ The inverse square law: For point masses/charges 𝑞 at 𝒙 = 𝒙𝟎, the
potential has the form 𝜑 = 𝐶𝑞/|𝒙 - 𝒙𝟎| for some constant 𝐶 > 0,
and the field is 𝒇 = -𝐶𝑞(𝒙 - 𝒙𝟎)/ 𝒙 - 𝒙𝟎 𝟑 with |𝒇| = 𝐶𝑞/ 𝒙 - 𝒙𝟎 𝟐
➢ For 𝑛 different masses/charges 𝑞𝑖 at 𝒙𝑖, the potential is
𝜑 = ෍
𝑖=1
𝑛
𝐶𝑞𝑖
𝒙 - 𝒙𝑖
Examples
➢ They are conservative because the energy integral ׯ 𝒇 ⋅ 𝑑𝒙 = 0 over
any closed loop in 𝒟 (to be understood in a later context)
Run Potential.py to find the potential
due to two point charges

## Page 7

Equipotential surfaces
For a conservative field 𝒇 = ∇𝜑, with potential 𝜑: 𝒟 -> ℝ, the level-
sets of 𝜑 are called equipotential surfaces.
Equipotential surfaces
If 𝒇 = ∇𝜑, for some function 𝜑: 𝒟 -> ℝ, then we call 𝒇 a conservative
field and 𝜑 a scalar potential.
Conservative field
𝒇 = 𝑥 Ƹ	 𝒊 - 𝑦 Ƹ	 𝒋
𝜑 = 1
2 𝑥2 - 𝑦2 + 𝑐
Find the potential and equipotential
surfaces of the field
𝒇 𝑥, 𝑦 =
𝑥
𝑎2 Ƹ	 𝒊+ 𝑦
𝑏2 Ƹ	 𝒋
𝑥2
𝑎2+𝑦2
𝑏2
3/2
Question 3

## Page 8

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
Show that the rotational field is not a
conservative field
Question 4.1
Verify that the following fields are conservative and find their potential:
1. 𝒇 = 𝑓1 𝑥 Ƹ	 𝒊 + 𝑓2(𝑦) Ƹ	 𝒋 +𝑓3 (𝑧) ෡	𝒌
2. 𝒇 = 2𝑥𝑦 - 𝑧2 Ƹ 𝒊 + 2𝑦𝑧 + 𝑥2 Ƹ 𝒋 - (2𝑧𝑥 - 𝑦2) ෡	𝒌
Question 4.2
