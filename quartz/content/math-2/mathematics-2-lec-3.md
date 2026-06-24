---
title: "Mathematics 2 - Lec 3"
date: "2026-06-04T10:51:53.097Z"
source: "upload"
knowledge_type: "source-document"
source_type: "pdf"
source_file: "Mathematics 2 - Lec 3.pdf"
generated_by: "chatmock"
topics: []
tags: ["mathematics-lec", "lec", "mathematics"]
source_pdf: "/math-2/assets/mathematics-2-lec-3-source.pdf"
---

## Summary

[[Page 1]]
Mathematics 2
(5EZB0)
Lecture 3
Koondi Mitra
Mathematics & Computer Science
Department
This Photo by Unknown Author is licensed under CC BY-SA

[[Page 2]]
Functions of several variables
Let 𝒟 ⊆ ℝ𝑑
, be a
domain. We denote a
multivariate function 𝑓 on the domain 𝒟 by
𝑓: 𝒟 → ℝ
also wr

## Knowledge tree

- No knowledge topics were extracted.

## Source material

## Page 1

Mathematics 2
(5EZB0)
Lecture 3
Koondi Mitra
Mathematics & Computer Science
Department
This Photo by Unknown Author is licensed under CC BY-SA

## Page 2

Functions of several variables
Let 𝒟 ⊆ ℝ𝑑
, be a
domain. We denote a
multivariate function 𝑓 on the domain 𝒟 by
𝑓: 𝒟 -> ℝ
also written for 𝒙 = 𝑥1, 𝑥2, . . , 𝑥𝑑 ∈ 𝒟 as
𝑓 𝒙
Use graph3d.py to define domains
and functions in 3D to plot
Source: Wikipedia
In ℝ𝑑+1

## Page 3

Domain & graph of a function
Can a sphere of radius 3 be
represented as a graph in
1. Cartesian coordinates
2. Other coordinate
systems
Questions 1.2
What is the maximum domain of
definition of
1. sin( 𝑥2 + 𝑦2)/ 𝑥2 + 𝑦2
2. ln(1 - 1 - 𝑥𝑦)
Questions 1.1

## Page 4

Level curves
Heightmap of Eindhoven
➢ Plots the contour of 𝑥, 𝑦 ∈ ℝ2 for which 𝑓 𝑥, 𝑦 = 𝐶
➢ Two level curves cannot intersect
➢ Isolated maximum/minimum points are surrounded by
closed loops

## Page 5

Level curves
Sphere
Saddle Cones

## Page 6

Level curves
1. Which point is steeper, A or B?
2. What is the topography of C?
3. Can you spot a peak?
Questions 2

## Page 7

Limit
Continuous functions
A function 𝑓 is continuous at 𝒙 = 𝒙0 if
lim
𝒙->𝒙𝟎
𝑓 𝒙 = 𝑓(𝒙0)
Case 2: 𝑥𝑦/(𝑥2 + 𝑦2)
Limit
lim
𝒙->𝒙𝟎
𝑓 𝒙 = 𝐿
1. If 𝒙0 is not an isolated point, i.e., for all 𝛿 > 0
𝐵𝛿 𝒙𝟎 ∩ 𝒟 != {𝑥0}
2. if for every 𝜖 > 0,
there exists 𝛿 > 0, such that
𝑓 𝒙 - 𝐿 < 𝜖 for all 𝒙 ∈ 𝐵𝛿 𝒙𝟎 ∩ 𝒟
➢ The limit, if existing, is unique
Case 1: 𝑥2𝑦/(𝑥2 + 𝑦2)

## Page 8

Limit
Limit
lim
𝒙->𝒙𝟎
𝑓 𝒙 = 𝐿
1. If 𝒙0 is not an isolated point, i.e., for all 𝛿 > 0
𝐵𝛿 𝒙𝟎 ∩ 𝒟 != {𝑥0}
2. if for every 𝜖 > 0,
there exists 𝛿 > 0, such that
𝑓 𝒙 - 𝐿 < 𝜖 for all 𝒙 ∈ 𝐵𝛿 𝒙𝟎 ∩ 𝒟
➢ The limit, if existing, is unique
Continuous functions
A function 𝑓 is continuous at 𝒙 = 𝒙0 if
lim
𝒙->𝒙𝟎
𝑓 𝒙 = 𝑓(𝒙0)
Case 2: 𝑥𝑦/(𝑥2 + 𝑦2)
Case 3: sin 𝑟 /𝑟

## Page 9

Properties of limits
Properties of limits
If 𝒙0 is not isolated in both the domains of 𝑓 and 𝑔:
1. lim
𝒙->𝒙𝟎
𝑓 𝒙 ± 𝑔 𝒙 = lim
𝒙->𝒙𝟎
𝑓 𝒙 ± lim
𝒙->𝒙𝟎
𝑔 𝒙
2. lim
𝒙->𝒙𝟎
𝑓 𝒙 𝑔 𝒙 = lim
𝒙->𝒙𝟎
𝑓 𝒙 lim
𝒙->𝒙𝟎
𝑔 𝒙
3. lim
𝒙->𝒙𝟎
𝑓 𝒙 /𝑔 𝒙 = lim
𝒙->𝒙𝟎
𝑓 𝒙 / lim
𝒙->𝒙𝟎
𝑔 𝒙 if lim
𝒙->𝒙𝟎
𝑔 𝒙 != 𝟎
Moreover, if 𝐹: ℝ -> ℝ is a continuous function, then
4. lim
𝒙->𝒙𝟎
𝐹 𝑓 𝒙 = 𝐹( lim
𝒙->𝒙𝟎
𝑓 𝒙 )
Do the following limits exist at 0,0 ?
1. 𝑥
𝑥2+𝑦2
2. sin 𝑥2𝑦
𝑥2+𝑦2
3. 2𝑥2𝑦
𝑥4+𝑦2
Question 3.1
Find the limit of sin 𝑥 - 𝑦 / cos 𝑥 + 𝑦 at (0,0).
Question 3.2

## Page 10

Partial derivatives
Let the function 𝑓 be continuous at a point 𝑥, 𝑦 ∈ 𝒟.
Its partial derivatives are then defined as
𝜕𝑓
𝜕𝑥 𝑥, 𝑦 = lim
ℎ->0
𝑓 𝑥 + ℎ, 𝑦 - 𝑓(𝑥, 𝑦)
ℎ
𝜕𝑓
𝜕𝑦 𝑥, 𝑦 = lim
𝑘->0
𝑓 𝑥, 𝑦 + 𝑘 - 𝑓(𝑥, 𝑦)
𝑘
If these limits exist.
➢ If you take partial derivative w.r.t one variable, then take
all other variables to be constant, and use normal rules
of differentiation
➢ 𝜕𝑓
𝜕𝑥 is also commonly written as 𝜕𝑥𝑓, 𝑓𝑥, or 𝑓1
Find 𝜕𝑥𝑓 of the following functions
1. 𝑥2 + 𝑥𝑦 + 𝑦2
2. 𝑒𝑥𝑦 sin 𝑥 + 𝑦 at (0, 𝜋)
Question 4
