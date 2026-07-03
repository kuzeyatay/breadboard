---
title: "Mathematics 2 - Lec 9"
date: "2026-06-04T10:51:42.721Z"
source: "upload"
knowledge_type: "source-document"
source_type: "pdf"
source_file: "Mathematics 2 - Lec 9.pdf"
generated_by: "chatmock"
topics: []
tags: ["mathematics-lec", "lec", "mathematics"]
source_pdf: "/math-2/assets/mathematics-2-lec-9-source.pdf"
---

## Summary

[[Page 1]]
Mathematics 2
(5EZB0)
Lecture 9
Koondi Mitra
Mathematics & Computer Science
Department
This Photo by Unknown Author is licensed under CC BY-SA-NC

[[Page 2]]
Triple integrals
ම
𝒟
𝑓 𝑥, 𝑦, 𝑧 𝑑𝑥𝑑𝑦𝑑𝑧
➢ Volume of domain 𝒟: ׬ ׬ ׬𝒟 𝑑𝑥𝑑𝑦𝑑𝑧, Mass of solid: ׬ ׬ ׬𝒟 𝜌 𝑥, 𝑦, 𝑧 

## Knowledge tree

- No knowledge topics were extracted.

## Source material

## Page 1

Mathematics 2
(5EZB0)
Lecture 9
Koondi Mitra
Mathematics & Computer Science
Department
This Photo by Unknown Author is licensed under CC BY-SA-NC

## Page 2

Triple integrals
ම
𝒟
𝑓 𝑥, 𝑦, 𝑧 𝑑𝑥𝑑𝑦𝑑𝑧
➢ Volume of domain 𝒟: ׬ ׬ ׬𝒟 𝑑𝑥𝑑𝑦𝑑𝑧, Mass of solid: ׬ ׬ ׬𝒟 𝜌 𝑥, 𝑦, 𝑧 𝑑𝑥𝑑𝑦𝑑𝑧
➢ Satisfies additivity, linearity, positivity, order preservation, and triangle inequality
➢ For 𝒟 ≔ { 𝑥, 𝑦, 𝑧 : 𝑎 <= 𝑥 <= 𝑏, 𝑐(𝑥) <= 𝑦 <= 𝑑(𝑥), 𝑒(𝑥, 𝑦) <= 𝑧 <= 𝑔(𝑥, 𝑦)}
න න න
𝒟
𝑓 𝑥, 𝑦, 𝑧 𝑑𝑥 𝑑𝑦 𝑑𝑧 = න
𝑎
𝑏
න
𝑐 𝑥
𝑑 𝑥
න
𝑒 𝑥,𝑦
𝑔 𝑥,𝑦
𝑓 𝑥, 𝑦, 𝑧 𝑑𝑧 𝑑𝑦 𝑑𝑥
➢ If 𝑓 is continuous, and an integral is well defined in two separate orders, then the
order of integration can be exchanged
➢ Higher order integrations are also written simply as ׬𝒟 𝑓𝑑𝑥
Run volume_integral.py to find the
volume and mass of a sphere using
voxels
Find the volume of the region
𝒱 ≔ {𝑥 + 2 <= 𝑦 <= 𝑥2,
0 <= 𝑧 <= 4 - 𝑦}
Questions 1

## Page 3

Change of variables
Now consider the change of variable
𝑥 = 𝑥 𝑢, 𝑣, 𝑤
𝑦 = 𝑦 𝑢, 𝑣, 𝑤
𝑧 = 𝑧 𝑢, 𝑣, 𝑤
➢ Let 𝑓 𝑥 𝑢, 𝑣, 𝑤 , 𝑦 𝑢, 𝑣, 𝑤 , 𝑧 𝑢, 𝑣, 𝑤 = ℎ 𝑢, 𝑣, 𝑤
➢ Let the domain 𝒟 be transformed into 𝑆 in 𝑢, 𝑣, 𝑤 coordinates
Then, the area element changes by 𝑑𝑥𝑑𝑦𝑑𝑧 = det 𝜕(𝑥,𝑦,𝑧)
𝜕(𝑢,𝑣,𝑤) 𝑑𝑢𝑑𝑣𝑑𝑤
න න න
𝒟
𝑓 𝑥, 𝑦, 𝑧 𝑑𝑥𝑑𝑦𝑑𝑧 = න න න
𝑆
ℎ 𝑢, 𝑣, 𝑤 det 𝜕(𝑥, 𝑦, 𝑧)
𝜕(𝑢, 𝑣, 𝑤) 𝑑𝑢𝑑𝑣𝑑𝑤
Find the volume of the curve
between z = 0 and 1
(𝑥 - 1)2
𝑎2 + (𝑦 - 2)2
𝑏2 = 𝑧3 + 1
Questions 2.1

## Page 4

Change of variables: cylindrical coordinate
Now consider the change of variable
𝑥 = 𝑟 cos 𝜃
𝑦 = 𝑟 sin 𝜃
𝑧 = 𝑧
which gives
𝜕(𝑥, 𝑦, 𝑧)
𝜕(𝑟, 𝜃, 𝑧) =
cos 𝜃 -r sin 𝜃 0
sin 𝜃 𝑟 cos 𝜃 0
0 0 1
And det 𝜕(𝑥,𝑦,𝑧)
𝜕(𝑟,𝜃,𝑧) = 𝑟
Find the coordinates of the center of mass
ҧ
𝑥𝑖 = ׬𝒟 𝑥𝑖𝜌𝑑𝑥 / ׬𝒟 𝜌𝑑𝑥 of the cone
𝒟 ≔ {𝑧 = 𝑥2 + 𝑦2, 0 <= 𝑧 <= ℎ}
Questions 3

## Page 5

Change of variables: spherical coordinate
Now consider the change of variable
𝑥 = 𝑅 sin 𝜙 cos 𝜃
𝑦 = 𝑅 sin 𝜙 sin 𝜃
𝑧 = 𝑅 cos 𝜙
which gives
𝜕(𝑥, 𝑦, 𝑧)
𝜕(𝑅, 𝜙, 𝜃) =
sin 𝜙 cos 𝜃 𝑅 cos 𝜙 cos 𝜃 -𝑅 sin 𝜙 sin 𝜃
sin 𝜙 sin 𝜃 R cos 𝜙 sin 𝜃 𝑅 sin 𝜙 cos 𝜃
cos 𝜙 -𝑅 sin 𝜙 0
And det 𝜕(𝑥,𝑦,𝑧)
𝜕(𝑅,𝜙,𝜃) = 𝑅2 sin 𝜙
Find the integral
න
ℝ3
𝑒-𝑥2-2𝑦2-3𝑧2
𝑑𝑥𝑑𝑦𝑑𝑧
Questions 4.2
Find the volume inside the sphere 𝑥2 + 𝑦2 + 𝑧2 = 𝑎2 and
the cone 𝑧 = 𝑥2 + 𝑦2? Find also the formula of the
volume of a sphere.
Questions 4.1

## Page 6

Surface area
Show that the surface area of the function
𝑧 = 𝑓 𝑟 (𝑟 > 0) is 2𝜋 ׬0
∞ 𝑟 1 + 𝑓′ 𝑟 2 𝑑𝑟
Questions 5.2 (surface of revolution)
Run surface_integral.py to find the
tessellation of surfaces
We saw earlier that a surface normal of 𝑧 = 𝑓 𝑥, 𝑦 is at
𝒏 = (∇𝑓(𝑥, 𝑦), -1)
➢ The angle with the 𝑧-axis is then cos 𝛾 = |𝒏⋅𝒌|
𝒏 |𝒌| = 1
1+ ∇𝑓 2
➢ Then the area of the surface element would be
𝑑𝒮 = 𝑑𝐴
cos 𝛾 = 1 + ∇𝑓 2 𝑑𝐴
➢ Then the surface area is
𝒮 = න න
𝒟
1 + ∇𝑓 2 𝑑𝐴
Find the area of the
surface of a sphere
Questions 5.1
What is the surface area and the volume over {𝑧 > 0}
of the function 𝑧 = 1
𝑟 in 𝐵1 0,0 = {𝑟 < 1}?
Questions 5.3 (Gabriel's horn)
This Photo by Unknown Author is
licensed under CC BY-SA-NC

## Page 7

Revisiting Scalar & Vector fields
For a domain 𝒟 ⊆ ℝ𝑑, a vector field 𝒇 is a function of the form
𝒇 𝒙 = (𝑓1 𝒙 , 𝑓2 𝒙 , ... , 𝑓𝑛 𝒙 )
written also as
𝒇: 𝒟 -> ℝ𝑛
Vector fields The vector field of
gravitational field
The vector field of rotating
object

## Page 8

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
2. A rotating object?
Question 6
