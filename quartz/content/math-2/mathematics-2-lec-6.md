---
title: "Mathematics 2 - Lec 6"
date: "2026-06-04T10:51:47.519Z"
source: "upload"
knowledge_type: "source-document"
source_type: "pdf"
source_file: "Mathematics 2 - Lec 6.pdf"
generated_by: "chatmock"
topics: []
tags: ["mathematics-lec", "lec", "mathematics"]
source_pdf: "/math-2/assets/mathematics-2-lec-6-source.pdf"
---

## Summary

[[Page 1]]
Mathematics 2
(5EZB0)
Lecture 6
Koondi Mitra
Mathematics & Computer Science
Department

[[Page 2]]
The gradient
If 𝑓: 𝒟 → ℝ is differentiable at a point 𝑥1, . . , 𝑥𝑑
∇𝑓 = 𝜕𝑓
𝜕𝑥1
, … , 𝜕𝑓
𝜕𝑥𝑑
= ෍
1≤𝑖≤𝑑
𝜕𝑓
𝜕𝑥𝑖
ො	𝒆𝑥𝑖
Gradient
➢ The gradient is perpendicular to the le

## Knowledge tree

- No knowledge topics were extracted.

## Source material

## Page 1

Mathematics 2
(5EZB0)
Lecture 6
Koondi Mitra
Mathematics & Computer Science
Department

## Page 2

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
the fastest, and |∇𝑓| is the maximum increase rate
What is the curve that passes through (1,1) and
intersects the level curves of 𝑓 𝑥, 𝑦 = 𝑥3 + 𝑦2
perpendicularly?
Questions 1
A graph of 𝑧 = 𝑓(𝑥, 𝑦) is the zero level-surface of
the function 𝑤 𝑥, 𝑦, 𝑧 = 𝑓 𝑥, 𝑦 - 𝑧
Remark

## Page 3

Important properties of gradient
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
If 𝑓, 𝒙 are all continuously differentiable, then
𝜕
𝜕𝑡 𝑓 𝒙 𝑡,⋅ = ∇𝑓 𝒙 𝑡,⋅ ⋅ 𝜕𝒙
𝜕𝑡
Chain rule

## Page 4

Vector fields and Jacobian
For a domain 𝒟 ⊆ ℝ𝑑, a vector field 𝒇 is a function of the form
𝒇 𝒙 = (𝑓1 𝒙 , 𝑓2 𝒙 , ... , 𝑓𝑛 𝒙 )
written also as
𝒇: 𝒟 -> ℝ𝑛
Vector fields
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
This Photo by Unknown Author is licensed under CC BY

## Page 5

Linear approximation
Let 𝑓: 𝒟 -> ℝ have continuous partial derivatives, 𝒙, 𝒙 + 𝒉 ∈ 𝒟 such
that the points connecting them lies in 𝒟.Then, there exists 𝜃 ∈ [0,1],
𝑓 𝒙 + 𝒉 - 𝑓 𝒙 = ∇𝑓 𝒙 + 𝜃𝒉 ⋅ 𝒉
Mean value theorem
What is the approximate value of the function
𝒇 𝑥, 𝑦 = (𝑥𝑒𝑦 + cos 𝜋𝑦 , 𝑥 - 𝑒𝑦)
at 𝑥, 𝑦 = 1.02, 0.01 ?
Questions 2Let 𝒉 ≪ 1. Then
𝑓 𝒙 + 𝒉 - 𝑓 𝒙 ~= 𝒉 ⋅ ∇𝑓 𝒙
Linear approximation

## Page 6

Higher order approximations
Let 𝑓: 𝒟 -> ℝ have continuous (𝑘 + 1)th order partial derivatives. Let 𝒙 ∈ 𝒟 and 𝒉 ∈ ℝ𝑑 be such that the line
connecting 𝒙 and 𝒙 + 𝒉 lies in 𝒟. Then, there exists 𝜃 ∈ [0,1],
𝑓 𝒙 + 𝒉 = 𝑓 𝒙 + 𝒉 ⋅ ∇𝑓 𝒙 + 1
2 𝒉 ⋅ ∇ 2𝑓 𝒙 + ⋯ + 1
𝑘! 𝒉 ⋅ ∇ 𝑘𝑓 𝒙 + 1
(𝑘 + 1)! 𝒉 ⋅ ∇ 𝑘+1𝑓 𝒙 + 𝜃𝒉
Higher order approximation
The matrix 𝐷2𝑓 ≔ 𝜕2𝑓
𝜕𝑥𝑖𝜕𝑥𝑗 1<=𝑖,𝑗<=𝑑
is called the Hessian matrix
The Hessian
1. Show that 𝐷2𝑓 is a symmetric matrix
2. Show that 𝐷 ∇𝑓 = 𝐷2𝑓
3. Show that 𝒉 ⋅ ∇ 2𝑓 = 𝒉 ⋅ (𝐷2𝑓)𝒉
Questions 3

## Page 7

Taylor series
Let 𝑓: 𝒟 -> ℝ be a smooth function (all higher order partial derivatives exist and are continuous). If there
exists an 𝑟 > 0, such that for all 𝒉 < 𝑟, one has 𝒉⋅∇ 𝑘𝑓 𝒙
𝑘! -> 0, then
𝑓 𝒙 + 𝒉 = 𝑓 𝒙 + ෍
𝑘=1
∞ 1
𝑘! 𝒉 ⋅ ∇ 𝑘𝑓 𝒙
Taylor series
Find the second order expansions of the following function around (0,0):
𝑓 𝑥, 𝑦 = 1 + 𝑥2 - 𝑦2
Questions 4
Run taylor.m to see the
comparison of the function
and the approximation

## Page 8

Double integrals
Finally, we arrive at Integration!! We need to give meaning to
න න
𝒟
𝑓 𝑥, 𝑦 𝑑𝐴
➢ The area under the curve is 𝑆 = ׬𝑎
𝑏 𝑓 𝑥 𝑑𝑥
➢ The volume under a graph is given by the
double integral
Let us first consider the rectangular domain 𝒟 = 𝑎, 𝑏 x 𝑐, 𝑑
Consider a partition 𝒫 of 𝑚 x 𝑛 rectangles 𝑅𝑖𝑗 = 𝑥𝑖-1, 𝑥𝑖 x [𝑦𝑗-1, 𝑦𝑗] :
𝑎 = 𝑥0 < 𝑥1 < 𝑥2 < ⋯ < 𝑥𝑚 = 𝑏
𝑐 = 𝑦0 < 𝑦1 < 𝑦2 < ⋯ < 𝑦𝑛 = 𝑑

## Page 9

Double integrals
➢ The rectangle 𝑅𝑖𝑗 = 𝑥𝑖-1, 𝑥𝑖 x [𝑦𝑗-1, 𝑦𝑗] has area
Δ𝐴𝑖𝑗: = (𝑥𝑖 - 𝑥𝑖-1)(𝑦𝑗 - 𝑦𝑗-1)
and diagonal 𝑑𝑖𝑗 ≔ 𝑥𝑖 - 𝑥𝑖-1 2 + 𝑦𝑗 - 𝑦𝑗-1
2
and let ||𝒫||: = max
1<=i<=𝑚 max
1<=𝑗<=𝑛 𝑑𝑖𝑗
➢ Now consider the Reimann sum: for some (𝑥𝑖𝑗
∗ , 𝑦𝑖𝑗
∗ ) ∈ 𝑅𝑖𝑗
𝑹 𝑓, 𝒫 = ෍
𝑖=1
𝑚
෍
𝑗=1
𝑛
𝑓 (𝑥𝑖𝑗
∗ , 𝑦𝑖𝑗
∗ ) Δ𝐴𝑖𝑗
➢ ׬ ׬𝒟 𝑓 𝑥, 𝑦 𝑑𝐴 = lim
||𝒫||->0 𝑹 𝑓, 𝒫
If 𝑓: 𝒟 -> ℝ is only discontinuous in a set which has measure 0, then the function 𝑓 is
integrable in 𝒟, and the integral does not depend on the choice of 𝒫 and the choice of (𝑥𝑖𝑗
∗ , 𝑦𝑖𝑗
∗ ).
Theorem

## Page 10

Riemann integrals
➢ If 𝒟 is not a rectangle, then consider a rectangle 𝑅 surrounding
it, and define
ሚ	𝑓 𝑥, 𝑦 = 𝑓 𝑥, 𝑦 when 𝑥, 𝑦 ∈ 𝒟, ሚ	𝑓 𝑥, 𝑦 = 0 otherwise.
Then, if boundary of 𝒟 has measure zero (𝒟 a Jordan set), then
න න
𝒟
𝑓 𝑥, 𝑦 𝑑𝐴 = න න
𝑅
ሚ	𝑓 𝑥, 𝑦 𝑑𝐴
What are the integrals
𝑎 න න𝑥2+𝑦2<=4
4 - 𝑥2 - 𝑦2 𝑑𝐴, 𝑏 න න𝑥2+𝑦2<=4
𝑥2 + 𝑦2 𝑑𝐴
Questions 5
Run DoubleIntegral.py to find
the Riemann sums with
different grids on the square
-1,1 2

## Page 11

Properties of the integrals
➢ If 𝒟 has 0 measure, then ׬ ׬𝒟 𝑓 𝑥, 𝑦 𝑑𝐴 = 0
➢ ׬ ׬𝒟(𝛼𝑓 𝑥, 𝑦 + 𝛽𝑔 𝑥, 𝑦 ) 𝑑𝐴 = 𝛼 ׬ ׬𝒟 𝑓 𝑥, 𝑦 𝑑𝐴 + 𝛽 ׬ ׬𝒟 𝑔 𝑥, 𝑦 𝑑𝐴 (Linearity)
➢ ׬ ׬𝒟 𝑓 𝑥, 𝑦 𝑑𝐴 <= ׬ ׬𝒟 𝑔 𝑥, 𝑦 𝑑𝐴 if 𝑓 𝑥, 𝑦 <= 𝑔 𝑥, 𝑦 in 𝒟 (Preserving ordering)
➢ ׬ ׬𝒟 𝑓 𝑥, 𝑦 𝑑𝐴 <= ׬ ׬𝒟 |𝑓 𝑥, 𝑦 | 𝑑𝐴 (Triangle inequality)
➢ Let 𝒟1, 𝒟2, ... , 𝒟𝑘 be disjoint domains. Then (Additivity)
න න
∪𝑖=1
𝑘 𝒟𝑖
𝑓 𝑥, 𝑦 𝑑𝐴 = ෍
1<=𝑖<=𝑘
න න
𝒟𝑘
𝑓 𝑥, 𝑦 𝑑𝐴
Find the integral (b) from Question 5 in the annulus {1 <= 𝑥2 + 𝑦2 <= 2}Questions 6
