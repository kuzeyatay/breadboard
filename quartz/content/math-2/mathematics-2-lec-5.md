---
title: "Mathematics 2 - Lec 5"
date: "2026-06-04T10:51:49.426Z"
source: "upload"
knowledge_type: "source-document"
source_type: "pdf"
source_file: "Mathematics 2 - Lec 5.pdf"
generated_by: "chatmock"
topics: []
tags: ["mathematics-lec", "lec", "mathematics"]
source_pdf: "/math-2/assets/mathematics-2-lec-5-source.pdf"
---

## Summary

[[Page 1]]
Mathematics 2
(5EZB0)
Lecture 5
Koondi Mitra
Mathematics & Computer Science
Department
This Photo by Unknown Author is licensed under CC BY-SA

[[Page 2]]
Partial derivatives
Let the function 𝑓 be continuous at a point
𝒙 = 𝑥1, 𝑥2, . . , 𝑥𝑑 ∈ 𝒟.
Its partial derivatives are then defi

## Knowledge tree

- No knowledge topics were extracted.

## Source material

## Page 1

Mathematics 2
(5EZB0)
Lecture 5
Koondi Mitra
Mathematics & Computer Science
Department
This Photo by Unknown Author is licensed under CC BY-SA

## Page 2

Partial derivatives
Let the function 𝑓 be continuous at a point
𝒙 = 𝑥1, 𝑥2, . . , 𝑥𝑑 ∈ 𝒟.
Its partial derivatives are then defined as
𝜕𝑓
𝜕𝑥1
𝒙 = lim
Δ𝑥1->0
𝑓 𝑥1 + Δ𝑥1, 𝑥2, . . , 𝑥𝑑 - 𝑓(𝑥1, 𝑥2, . . , 𝑥𝑑)
Δ𝑥1
𝜕𝑓
𝜕𝑥2
𝒙 = lim
Δ𝑥2->0
𝑓 𝑥1, 𝑥2 + Δ𝑥2, . . , 𝑥𝑑 - 𝑓(𝑥1, 𝑥2, . . , 𝑥𝑑)
Δ𝑥2
⋮
If these limits exist.

## Page 3

Second order derivatives
Let the function 𝑓 have continuous partial derivatives at a point 𝒙 = (𝑥1, 𝑥2, . . , 𝑥𝑑) ∈ 𝒟.
Then its higher order derivatives are defined as
𝜕2𝑓
𝜕𝑥1
2 𝒙 = 𝜕
𝜕𝑥1
𝜕𝑓
𝜕𝑥1
𝒙 = lim
Δ𝑥1->0
𝜕𝑥1 𝑓 𝑥1 + Δ𝑥1, 𝑥2, . . , 𝑥𝑑 - 𝜕𝑥1 𝑓(𝑥1, 𝑥2, . . , 𝑥𝑑)
Δ𝑥1
𝜕2𝑓
𝜕𝑥2𝜕𝑥1
𝒙 = 𝜕
𝜕𝑥2
𝜕𝑓
𝜕𝑥1
𝒙 = lim
Δ𝑥2->0
𝜕𝑥1 𝑓 𝑥1, 𝑥2 + Δ𝑥2, . . , 𝑥𝑑 - 𝜕𝑥1 𝑓(𝑥1, 𝑥2, . . , 𝑥𝑑)
Δ𝑥2
If these limits exist.
Let 𝑓: 𝒟 -> ℝ have continuous second order partial derivatives at a point 𝒙0 = 𝑥1, 𝑥2, ... , 𝑥𝑑 ∈ 𝒟.
Then for all 1 <= 𝑖, 𝑗 <= 𝑑,
𝜕2𝑓
𝜕𝑥𝑖𝜕𝑥𝑗
𝒙𝟎 = 𝜕2𝑓
𝜕𝑥𝑗𝜕𝑥𝑖
𝒙𝟎
Schwarz/Clairaut theorem

## Page 4

The chain rule
Let the functions 𝒙 𝑡,⋅ = (𝑥1 𝑡,⋅ , . . , 𝑥𝑑(𝑡,⋅)) depend on 𝑡.
Consider a function 𝑓: 𝒟 -> ℝ.
How does 𝑓(𝒙(𝑡,⋅)) change with 𝑡?
source: sciencesprings.wordpress.com
If 𝑓, 𝒙 are all continuously differentiable, then
𝜕
𝜕𝑡 𝑓 𝒙 𝑡,⋅ = ෍
1<=𝑖<=𝑑
𝜕𝑓
𝜕𝑥𝑖
𝜕𝑥𝑖
𝜕𝑡
Chain rule

## Page 5

The gradient
If 𝑓, 𝒙 are all continuously differentiable, then
𝜕
𝜕𝑡 𝑓 𝒙 𝑡,⋅ = ∇𝑓 𝒙 𝑡,⋅ ⋅ 𝜕𝒙
𝜕𝑡
Chain rule (revisited)
If 𝑓: 𝒟 -> ℝ is differentiable at a point 𝑥1, . . , 𝑥𝑑
∇𝑓 = 𝜕𝑓
𝜕𝑥1
, ... , 𝜕𝑓
𝜕𝑥𝑑
= ෍
1<=𝑖<=𝑑
𝜕𝑓
𝜕𝑥𝑖
ො	𝒆𝑥𝑖
Gradient
➢ ∇𝑓 is also commonly denoted by grad(𝑓)
Run grad_demo.m to plot the function
1 + 𝑒 𝑥-3 2+𝑦2
2∗22 + 𝑒 𝑥+3 2+𝑦2
2∗22
its contour and its gradient. What is the relation
between the gradient and contour?

## Page 6

The gradient
If 𝑓: 𝒟 -> ℝ is differentiable at a point 𝑥1, . . , 𝑥𝑑
∇𝑓 = 𝜕𝑓
𝜕𝑥1
, ... , 𝜕𝑓
𝜕𝑥𝑑
= ෍
1<=𝑖<=𝑑
𝜕𝑓
𝜕𝑥𝑖
ො	𝒆𝑥𝑖
Gradient
➢ The gradient is perpendicular to the level sets
➢ The ∇𝑓 is along the direction in which 𝑓 increases
the fastest
➢ The maximum rate of increase is |∇𝑓|
In cylindrical coordinate
∇𝑓 = 𝜕𝑓
𝜕𝑟 ො	𝒓 + 1
𝑟
𝜕𝑓
𝜕𝜃 ෡	𝜽 + 𝜕𝑓
𝜕𝑧 ෡	𝒌.
What will be the formula in
spherical coordinate?
Note
Let 𝑓 𝑥, 𝑦 = 𝐶
𝑥2+𝑦2 .
Find ∇𝑓 and |∇𝑓|.
Do you see a connection of this
with physics?
Questions 1.1
Let 𝑓 𝑥, 𝑦 = ln 𝑥2 + 𝑦2 .
What is the tangent line of the level
set of this curve at 𝑥0, 𝑦0 ?
Questions 1.2

## Page 7

Tangent planes revisited
➢ The tangent plane of a surface 𝑧 = 𝑓 𝑥, 𝑦 at a point (𝑥0, 𝑦0) is
𝜕𝑓
𝜕𝑥 𝑥0, 𝑦0 𝑥 - 𝑥0 + 𝜕𝑓
𝜕𝑦 𝑥0, 𝑦0 𝑦 - 𝑦0 - 𝑧 - 𝑓 𝑥0, 𝑦0 = 0
Or
𝑧 - 𝑓 𝑥0, 𝑦0 = ∇𝑓(𝑥0, 𝑦0) ⋅ (𝒙 - 𝒙0)
➢ The normal to this plain at point 𝑥0, 𝑦0 is
𝜕𝑓
𝜕𝑥 𝑥0, 𝑦0 , 𝜕𝑓
𝜕𝑦 𝑥0, 𝑦0 , -1 = (∇𝑓(𝑥0, 𝑦0), -1)
What is the tangent line at (1,1,√2) on the intersection
curve of the cylinder 𝑥2 + (𝑦 - 1)2= 1 and the sphere
𝑥2 + 𝑦2 + 𝑧2 = 4?
Question 2

## Page 8

Linear approximation
Let 𝑓: 𝒟 -> ℝ have continuous partial derivatives, 𝒙0, 𝒙1 ∈ 𝒟 such that
the points connecting them lies in 𝒟.Then, there exists 𝜃 ∈ [0,1],
𝑓 𝒙1 - 𝑓 𝒙0 = ∇𝑓 𝒙0 + 𝜃 𝒙1 - 𝒙0 ⋅ 𝒙1 - 𝒙0
Mean value theorem
What is the approximate value of the function
𝑓 𝑥, 𝑦 = sin 𝜋𝑥𝑦 + ln 𝑦
at 𝑥, 𝑦 = .05, 1.1 ?
Questions 3
Let 𝒙1 - 𝒙0 ≪ 1. Then
𝑓 𝒙1 - 𝑓 𝒙0 ~= ∇𝑓 𝒙0 ⋅ (𝒙1 - 𝒙0)
Linear approximation
➢ Another version of the theorem that does not require the line
connecting 𝒙0, 𝒙1to lie on 𝒟 is given in Theorem 3.

## Page 9

Directional derivatives
Directional derivative along a unit vector ෝ	𝒖 = 𝑢1, . . , 𝑢𝑑 .
𝐷ෝ	𝒖𝑓 𝒙 = lim
𝑡 ->0
𝑓 𝑥1 + 𝑡𝑢1, 𝑥2 + 𝑡𝑢2, . . , 𝑥𝑑 + 𝑡𝑢𝑑 - 𝑓 𝑥1, 𝑥2, . . , 𝑥𝑑
𝑡
= lim
𝑡->0
𝑓 𝒙 + 𝑡 ෝ	𝒖 - 𝑓(𝒙)
𝑡 = ∇𝑓(𝒙) ⋅ ෝ	𝒖
Directional derivatives
Recall the mountain profile
𝐻 𝑥, 𝑦 = sin 𝑥 sin 𝑦 .
You are hiking along the path 𝑦 = 𝑥2 - 2. What
is the rate of elevation change per horizontal
distance at (-1,-1)?
Questions 4.2
Prove that along
∇𝑓 indeed 𝑓 increases
at the fastest rate with
magnitude |∇𝑓|.
Questions 4.1

## Page 10

Vector fields
For a domain 𝒟 ⊆ ℝ𝑑, a vector field 𝒇 is a function of the form
𝒇 𝒙 = (𝑓1 𝒙 , 𝑓2 𝒙 , ... , 𝑓𝑛 𝒙 )
written also as
𝒇: 𝒟 -> ℝ𝑛
Vector fields
➢ Observe that the function ∇𝑓(𝒙) points 𝒙 ∈ ℝ𝑑 to ∇𝑓 𝒙 ∈ ℝ𝑑.
This motivates us to introduce the concept of vector fields
Run vector_field.m and make a quiver-plot of a given
vector field

## Page 11

The Jacobian
For a domain 𝒟 ⊆ ℝ𝑑, consider the vector field 𝒇: 𝒟 -> ℝ𝑛 and let it
be continuous at 𝑥 ∈ 𝒟. Then the Jacobian is the 𝑛 x 𝑑 matrix
𝐷𝒇 𝒙 =
𝜕𝑓1
𝜕𝑥1
(𝒙) ... 𝜕𝑓1
𝜕𝑥𝑑
(𝒙)
⋮ ⋱ ⋮
𝜕𝑓𝑛
𝜕𝑥1
(𝒙) ... 𝜕𝑓𝑛
𝜕𝑥𝑑
(𝒙)
provided all the derivatives exist.
The Jacobian
➢ What is the differentiation of a vector field?
➢ 𝐷𝒇 is also denoted by 𝜕(𝑓1,..,𝑓𝑛)
𝜕(𝑥1,..,𝑥𝑑) and 𝛁𝒇
Find the Jacobian for the following
functions
❑ Cylindrical -> Cartesian
transform
𝑥, 𝑦, 𝑧 = 𝑟 cos 𝜃, 𝑟 sin 𝜃, 𝑧
❑ Spherical -> Cartesian
transform
𝑥, 𝑦, 𝑧 =
𝑅 sin 𝜙 cos 𝜃, 𝑅 sin 𝜙 sin 𝜃 , 𝑅 cos 𝜙
❑ 𝒈 𝑥, 𝑦, 𝑧 = (ln(
)
𝑥2 +
𝑦𝑧 , sin 𝑥𝑦
𝑧 , 𝑒-(𝑥2+𝑦2+𝑧2))
Questions 5
Let 𝒇: ℝ𝑑 -> ℝ𝑛 and 𝒈: ℝ𝑛 -> ℝ𝑚 be differentiable functions. Then,
𝐷 𝒈 ∘ 𝒇 𝒙 = 𝐷𝒈 𝒇 𝒙 𝐷𝒇(𝒙)
Chain Rule
