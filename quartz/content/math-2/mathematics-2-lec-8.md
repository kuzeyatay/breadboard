---
title: "Mathematics 2 - Lec 8"
date: "2026-06-04T10:51:44.347Z"
source: "upload"
knowledge_type: "source-document"
source_type: "pdf"
source_file: "Mathematics 2 - Lec 8.pdf"
generated_by: "chatmock"
topics: []
tags: ["mathematics-lec", "lec", "mathematics"]
source_pdf: "/math-2/assets/mathematics-2-lec-8-source.pdf"
---

## Summary

[[Page 1]]
Mathematics 2
(5EZB0)
Lecture 8
Koondi Mitra
Mathematics & Computer Science Department
This Photo by Unknown Author is licensed under CC BY

[[Page 2]]
Integrals in Cartesian coordinates: domains
𝑥-simple domains
Let 𝑐, 𝑑: 𝑎, 𝑏 → ℝ be continuous, and
𝒟 ≔ { 𝑥, 𝑦 : 𝑎 ≤ 𝑥 ≤ 𝑏,
𝑐 

## Knowledge tree

- No knowledge topics were extracted.

## Source material

## Page 1

Mathematics 2
(5EZB0)
Lecture 8
Koondi Mitra
Mathematics & Computer Science Department
This Photo by Unknown Author is licensed under CC BY

## Page 2

Integrals in Cartesian coordinates: domains
𝑥-simple domains
Let 𝑐, 𝑑: 𝑎, 𝑏 -> ℝ be continuous, and
𝒟 ≔ { 𝑥, 𝑦 : 𝑎 <= 𝑥 <= 𝑏,
𝑐 𝑥 <= 𝑦 <= 𝑑(𝑥)}
𝑦-simple domains
Let a, 𝑏: 𝑐, 𝑑 -> ℝ be continuous, and
𝒟 ≔ { 𝑥, 𝑦 : 𝑐 <= 𝑦 <= 𝑑,
𝑎 𝑦 <= 𝑥 <= 𝑏(𝑦)}
Regular domains
Domains that can be decomposed into
a finite number of 𝑥-simple or 𝑦-
simple domains.

## Page 3

Integrals in Cartesian coordinates: computation
➢ 𝑥-simple domain: ∫ ∫𝒟 𝑓 𝑥, 𝑦 𝑑𝐴 = ∫𝑎
𝑏 ∫𝑐 𝑥
𝑑 𝑥 𝑓 𝑥, 𝑦 𝑑𝑦 𝑑𝑥
➢ 𝑦-simple domain: ∫ ∫𝒟 𝑓 𝑥, 𝑦 𝑑𝐴 = ∫𝑐
𝑑 ∫𝑎 𝑦
𝑏 𝑦 𝑓 𝑥, 𝑦 𝑑𝑥 𝑑𝑦
If 𝒟 is both 𝑥-simple and 𝑦-simple and
𝑓: 𝒟 -> ℝ is continuous, then both
integrals are the same.
Fubini's Theorem
Hence, we also write (with the association
𝑑𝐴 = 𝑑𝑥𝑑𝑦)
න න
𝒟
𝑓 𝑥, 𝑦 𝑑𝐴 as න න
𝒟
𝑓 𝑥, 𝑦 𝑑𝑥𝑑𝑦
Find the integral
න
0
𝜋/2
න
𝑦
𝜋/2 sin 𝑥
𝑥 𝑑𝑥𝑑𝑦
Question 1

## Page 4

Integrals in polar coordinates: domains
For functions that are easier to write in terms of cylindrical coordinates, can be integrated differently.
Let
𝑓 𝑥, 𝑦 = 𝑓 𝑟 cos 𝜃, 𝑟 sin 𝜃 = ℎ 𝑟, 𝜃
Noticing that an infinitesimal 𝑑𝐴 can be
represented by 𝑑𝑥𝑑𝑦 = 𝑟𝑑𝑟𝑑𝜃,
one has
න න
𝒟
𝑓 𝑥, 𝑦 𝑑𝐴 = න න
𝒟
𝑓 𝑥, 𝑦 𝑑𝑥𝑑𝑦
= න න
𝒟
ℎ 𝑟, 𝜃 𝑟𝑑𝑟𝑑𝜃

## Page 5

Integrals in polar coordinates: computing
For functions that are easier to write in terms of cylindrical coordinates, can be integrated differently.
න න
𝑅
ℎ(𝑟, 𝜃) 𝑟𝑑𝑟𝑑𝜃
= න
𝑎
𝑏
න
0
𝜋
4
ℎ(𝑟, 𝜃) 𝑑𝜃 𝑟𝑑𝑟
න න
𝑅
ℎ (𝑟, 𝜃) 𝑟𝑑𝑟𝑑𝜃
= න
𝛼
𝛽
න
0
𝑓(𝜃)
ℎ(𝑟, 𝜃) 𝑟𝑑𝑟 𝑑𝜃
Let
𝑓 𝑥, 𝑦 = 𝑓 𝑟 cos 𝜃, 𝑟 sin 𝜃 = ℎ 𝑟, 𝜃
Noticing that an infinitesimal 𝑑𝐴 can be
represented by 𝑑𝑥𝑑𝑦 = 𝑟𝑑𝑟𝑑𝜃,
one has
න න
𝒟
𝑓 𝑥, 𝑦 𝑑𝐴 = න න
𝒟
𝑓 𝑥, 𝑦 𝑑𝑥𝑑𝑦
= න න
𝒟
ℎ 𝑟, 𝜃 𝑟𝑑𝑟𝑑𝜃
Prove that ∫-∞
∞ 𝑒-𝑥2
𝑑𝑥 = √𝜋
Questions 2.1 For 𝒟 ≔ {𝑥 <= 𝑦, 1 <= 𝑥2 + 𝑦2 <= 2},
find ∫ ∫𝒟 𝑥𝑦 𝑑𝑥𝑑𝑦
Questions 2.2

## Page 6

Change of variables: domains
If a variable transformation is
made from 𝑥, 𝑦 -> 𝑢, 𝑣 then
how does the integral change?
Let
𝑥 = 𝑥 𝑢, 𝑣 ,
𝑦 = 𝑦 𝑢, 𝑣 .
Then formally, the infinitesimal
area 𝑑𝐴 transforms as
𝑑𝐴 = 𝑑𝑥𝑑𝑦 = det 𝜕(𝑥, 𝑦)
𝜕(𝑢, 𝑣) 𝑑𝑢𝑑𝑣
Let the domain of integral 𝒟 in (𝑥, 𝑦) plane be changed to 𝑆 in 𝑢, 𝑣 plane

## Page 7

Change of variables: integrals
Let
𝑥 = 𝑥 𝑢, 𝑣
𝑦 = 𝑦(𝑢, 𝑣)
and
𝑓 𝑥 𝑢, 𝑣 , 𝑦 𝑢, 𝑣 = ℎ 𝑢, 𝑣 .
Let the domain of integral 𝒟 in (𝑥, 𝑦) plane be
changed to 𝑆 in 𝑢, 𝑣 plane
න න
𝒟
𝑓(𝑥, 𝑦) 𝑑𝑥𝑑𝑦 = න න
𝑆
ℎ(𝑢, 𝑣) det 𝜕(𝑥, 𝑦)
𝜕(𝑢, 𝑣) 𝑑𝑢𝑑𝑣
Show that in polar coordinate,
𝑑𝐴 = 𝑟𝑑𝑟𝑑𝜃
Questions 3.1
Using coordinate transform, find
the area of the ellipse 𝑥2
𝑎2 + 𝑦2
𝑏2 <= 1
Questions 3.2
Find the integral ∫ ∫𝒟 𝑥𝑦𝑑𝑥𝑑𝑦
for the domain 𝒟 shown in the picture
Questions 3.3

## Page 8

Triple integrals
ම
𝒟
𝑓 𝑥, 𝑦, 𝑧 𝑑𝑥𝑑𝑦𝑑𝑧
➢ Volume of domain 𝒟: ∫ ∫ ∫𝒟 𝑑𝑥𝑑𝑦𝑑𝑧
➢ Mass of solid: ∫ ∫ ∫𝒟 𝜌 𝑥, 𝑦, 𝑧 𝑑𝑥𝑑𝑦𝑑𝑧
➢ For 𝒟 ≔ { 𝑥, 𝑦, 𝑧 : 𝑎 <= 𝑥 <= 𝑏, 𝑐(𝑥) <= 𝑦 <= 𝑑(𝑥), 𝑒(𝑥, 𝑦) <= 𝑧 <= 𝑓(𝑥, 𝑦)}
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
𝑓 𝑥,𝑦
𝑓 𝑥, 𝑦, 𝑧 𝑑𝑧 𝑑𝑦 𝑑𝑥
➢ If 𝑓 is continuous, and an integral is well defined in two separate orders,
then the order of integration can be exchanged
➢ Higher order integrations are also written simply as ∫𝒟 𝑓𝑑𝑥

## Page 9

Triple integrals
What is the 𝑧-coordinate of the
center of mass of a uniformly
dense tetrahedron with vertices
at ±1,0,0 , 0,1,0 , and (0,0,1)
Questions 4.1
What is the moment of inertia of
the sphere 𝑥2 + 𝑦2 + 𝑧2 = 𝑅2
along the 𝑧-axis?
Questions 4.2
ҧ
𝑥𝑖 = න
𝒟
𝑥𝑖𝜌 𝒙 𝑑𝑥 / න
𝒟
𝜌 𝒙 𝑑𝑥
𝐼𝑧 = න
𝒟
𝑟2𝜌 𝒙 𝑑𝑥
Find the volume of the region under the plane 𝑧 =
3 - 2𝑦 and above the paraboloid 𝑧 = 𝑥2 + 𝑦2
Questions 4.3
ම
𝒟
𝑓 𝑥, 𝑦, 𝑧 𝑑𝑥𝑑𝑦𝑑𝑧
➢ Volume of domain 𝒟: ∫ ∫ ∫𝒟 𝑑𝑥𝑑𝑦𝑑𝑧
➢ Mass of solid: ∫ ∫ ∫𝒟 𝜌 𝑥, 𝑦, 𝑧 𝑑𝑥𝑑𝑦𝑑𝑧
➢ For 𝒟 ≔ { 𝑥, 𝑦, 𝑧 : 𝑎 <= 𝑥 <= 𝑏, 𝑐(𝑥) <= 𝑦 <= 𝑑(𝑥), 𝑒(𝑥, 𝑦) <= 𝑧 <= 𝑓(𝑥, 𝑦)}
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
𝑓 𝑥,𝑦
𝑓 𝑥, 𝑦, 𝑧 𝑑𝑧 𝑑𝑦 𝑑𝑥
➢ If 𝑓 is continuous, and an integral is well defined in two separate orders,
then the order of integration can be exchanged
➢ Higher order integrations are also written simply as ∫𝒟 𝑓𝑑𝑥

## Page 10

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
Questions 5
