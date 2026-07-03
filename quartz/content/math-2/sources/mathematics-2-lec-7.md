---
title: "Mathematics 2 - Lec 7"
date: "2026-06-04T10:51:45.911Z"
source: "upload"
knowledge_type: "source-document"
source_type: "pdf"
source_file: "Mathematics 2 - Lec 7.pdf"
generated_by: "chatmock"
topics: []
tags: ["mathematics-lec", "lec", "mathematics"]
source_pdf: "/math-2/assets/mathematics-2-lec-7-source.pdf"
---

## Summary

[[Page 1]]
Mathematics 2
(5EZB0)
Lecture 7
Koondi Mitra
Mathematics & Computer Science
Department

[[Page 2]]
Taylor series
Let 𝑓: 𝒟 → ℝ have continuous (𝑘 + 1)th order partial derivatives. Let 𝒙 ∈ 𝒟 and 𝒉 ∈ ℝ𝑑 be such that the line
connecting 𝒙 and 𝒙 + 𝒉 lies in 𝒟. Then, there exists 𝜃 

## Knowledge tree

- No knowledge topics were extracted.

## Source material

## Page 1

Mathematics 2
(5EZB0)
Lecture 7
Koondi Mitra
Mathematics & Computer Science
Department

## Page 2

Taylor series
Let 𝑓: 𝒟 -> ℝ have continuous (𝑘 + 1)th order partial derivatives. Let 𝒙 ∈ 𝒟 and 𝒉 ∈ ℝ𝑑 be such that the line
connecting 𝒙 and 𝒙 + 𝒉 lies in 𝒟. Then, there exists 𝜃 ∈ [0,1],
𝑓 𝒙 + 𝒉 = 𝑓 𝒙 + 𝒉 ⋅ ∇𝑓 𝒙 + 1
2 𝒉 ⋅ ∇ 2𝑓 𝒙 + ⋯ + 1
𝑘! 𝒉 ⋅ ∇ 𝑘𝑓 𝒙 + 1
(𝑘 + 1)! 𝒉 ⋅ ∇ 𝑘+1𝑓 𝒙 + 𝜃𝒉
Higher order approximation
Let 𝑓: 𝒟 -> ℝ be a smooth function (all higher order partial derivatives exist and are continuous). If there
exists an 𝑟 > 0, such that for all 𝒉 < 𝑟, one has 𝒉⋅∇ 𝑘𝑓 𝒙
𝑘! -> 0, then
𝑓 𝒙 + 𝒉 = 𝑓 𝒙 + ෍
𝑘=1
∞ 1
𝑘! 𝒉 ⋅ ∇ 𝑘𝑓 𝒙
Taylor series

## Page 3

Double integrals
➢ Consider the rectangles 𝑅𝑖𝑗 = 𝑥𝑖-1, 𝑥𝑖 x [𝑦𝑗-1, 𝑦𝑗 ] where
𝑎 = 𝑥0 < 𝑥1 < 𝑥2 < ⋯ < 𝑥𝑚 = 𝑏
𝑐 = 𝑦0 < 𝑦1 < 𝑦2 < ⋯ < 𝑦𝑛 = 𝑑
➢ 𝑅𝑖𝑗 has area Δ𝐴𝑖𝑗 : = (𝑥𝑖 - 𝑥𝑖-1)(𝑦𝑗 - 𝑦𝑗-1) and diagonal 𝑑𝑖𝑗 > 0
➢ consider the partition 𝒫 = 𝑅𝑖𝑗 0 <= 𝑖 <= 𝑚, 0 <= 𝑗 <= 𝑛} and
let ||𝒫||: = max
1<=i<=𝑚 max
1<=𝑗<=𝑛 𝑑𝑖𝑗
➢ Now consider the Reimann sum: for some (𝑥𝑖𝑗
∗ , 𝑦𝑖𝑗
∗ ) ∈ 𝑅𝑖𝑗 ∈ 𝒫,
𝑹 𝑓, 𝒫 = ෍
𝑖=1
𝑚
෍
𝑗=1
𝑛
𝑓 (𝑥𝑖𝑗
∗ , 𝑦𝑖𝑗
∗ ) Δ𝐴𝑖𝑗
➢ ∫ ∫𝒟 𝑓 𝑥, 𝑦 𝑑𝐴 = lim
||𝒫||->0 𝑹 𝑓, 𝒫
If 𝑓: 𝒟 -> ℝ is only discontinuous in a set which has measure 0, then the function 𝑓 is integrable in 𝒟, and
the integral does not depend on the choice of 𝒫 and the choice of (𝑥𝑖𝑗
∗ , 𝑦𝑖𝑗
∗ ).
Theorem

## Page 4

Riemann integrals
➢ If 𝒟 is not a rectangle, then consider a rectangle 𝑅 surrounding
it, and define
ሚ	𝑓 𝑥, 𝑦 = 𝑓 𝑥, 𝑦 when 𝑥, 𝑦 ∈ 𝒟, ሚ	𝑓 𝑥, 𝑦 = 0 otherwise.
Then, if boundary of 𝒟 has measure zero, then
න න
𝒟
𝑓 𝑥, 𝑦 𝑑𝐴 = න න
𝑅
ሚ	𝑓 𝑥, 𝑦 𝑑𝐴
➢ ∫ ∫𝒟 𝑓 𝑥, 𝑦 𝑑𝐴 >= 0 if 𝑓 𝑥, 𝑦 >= 0
➢ ∫ ∫𝒟 1 𝑑𝐴 = |𝒟| (Area of 𝒟), and ∫ ∫𝒟 0 𝑑𝐴 = 0,
Properties of integrals

## Page 5

Properties of the integrals
➢ If 𝒟 has 0 measure, then ∫ ∫𝒟 𝑓 𝑥, 𝑦 𝑑𝐴 = 0
➢ ∫ ∫𝒟(𝛼𝑓 𝑥, 𝑦 + 𝛽𝑔 𝑥, 𝑦 ) 𝑑𝐴 = 𝛼 ∫ ∫𝒟 𝑓 𝑥, 𝑦 𝑑𝐴 + 𝛽 ∫ ∫𝒟 𝑔 𝑥, 𝑦 𝑑𝐴 (Linearity)
➢ ∫ ∫𝒟 𝑓 𝑥, 𝑦 𝑑𝐴 <= ∫ ∫𝒟 𝑔 𝑥, 𝑦 𝑑𝐴 if 𝑓 𝑥, 𝑦 <= 𝑔 𝑥, 𝑦 in 𝒟 (Preserving ordering)
➢ ∫ ∫𝒟 𝑓 𝑥, 𝑦 𝑑𝐴 <= ∫ ∫𝒟 |𝑓 𝑥, 𝑦 | 𝑑𝐴 (Triangle inequality)
➢ Let 𝒟1, 𝒟2, ... , 𝒟𝑘 be disjoint domains. Then (Additivity)
න න
∪𝑖=1
𝑘 𝒟𝑖
𝑓 𝑥, 𝑦 𝑑𝐴 = ෍
1<=𝑖<=𝑘
න න
𝒟𝑘
𝑓 𝑥, 𝑦 𝑑𝐴
Find the integral ∫ ∫1<=𝑥2+𝑦2<=2 𝑥2 + 𝑦2 𝑑𝐴Questions 1

## Page 6

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
Convex polygons, ellipses
etc. are both x- and y-simple.
Examples Can you find some non-
regular domains in 0,1 2?
Questions 2

## Page 7

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
Hence, we also write (with the association of
𝑑𝐴 as 𝑑𝑥 𝑑𝑦)
න න
𝒟
𝑓 𝑥, 𝑦 𝑑𝐴 as න න
𝒟
𝑓 𝑥, 𝑦 𝑑𝑥𝑑𝑦
Run Integral_slice.py to see how
the volume can be calculated using
slices

## Page 8

Integrals in Cartesian coordinates: computation
➢ 𝑥-simple domain: ∫ ∫𝒟 𝑓 𝑥, 𝑦 𝑑𝐴 = ∫𝑎
𝑏 ∫𝑐 𝑥
𝑑 𝑥 𝑓 𝑥, 𝑦 𝑑𝑦 𝑑𝑥
➢ 𝑦-simple domain: ∫ ∫𝒟 𝑓 𝑥, 𝑦 𝑑𝐴 = ∫𝑐
𝑑 ∫𝑎 𝑥
𝑏 𝑥 𝑓 𝑥, 𝑦 𝑑𝑥 𝑑𝑦
If 𝒟 is both 𝑥-simple and 𝑦-simple and
𝑓: 𝒟 -> ℝ is continuous, then both
integrals are the same.
Fubini's Theorem
Hence, we also write (with also the
association of 𝑑𝐴 as 𝑑𝑥 𝑑𝑦)
∫ ∫𝒟 𝑓 𝑥, 𝑦 𝑑𝐴 as ∫ ∫𝒟 𝑓 𝑥, 𝑦 𝑑𝑥𝑑𝑦
1. Show ∫𝑎
𝑏 ∫𝑐
𝑑 𝑓 𝑥 𝑔 𝑦 𝑑𝑥𝑑𝑦 = ∫𝑎
𝑏 𝑓(𝑥)𝑑𝑥 ∫𝑐
𝑑 𝑔(𝑦)𝑑𝑦
2. Evaluate the integral ∫0
1 ∫√𝑥
1 𝑒𝑦3
𝑑𝑥𝑑𝑦
3. Evaluate the integral ∫ ∫𝑥> 𝑦 >0 𝑒-𝑥2
𝑑𝑥𝑑𝑦
3. Find the volume of the sphere using:
∫ ∫𝑥2+𝑦2<=1 1 - 𝑥2 - 𝑦2𝑑𝑥𝑑𝑦
Questions 3
∫ 1 - 𝑥2𝑑𝑥
= 1
2 sin-1 𝑥 + 1
2 𝑥 1 - 𝑥2 + 𝑐

## Page 9

Integrals in polar coordinates: domains
For functions that are easier to write in terms of cylindrical coordinates, can be integrated differently.
Let
𝑓 𝑥, 𝑦 = 𝑓 𝑟 cos 𝜃, 𝑟 sin 𝜃 = ℎ 𝑟, 𝜃
Noticing that an infinitesimal 𝑑𝐴 can be
represented by 𝑑𝑥𝑑𝑦, but also by 𝑟𝑑𝑟𝑑𝜃,
one has
න න
𝒟
𝑓 𝑥, 𝑦 𝑑𝐴 = න න
𝒟
𝑓 𝑥, 𝑦 𝑑𝑥𝑑𝑦
= න න
𝒟
ℎ 𝑟, 𝜃 𝑟𝑑𝑟𝑑𝜃

## Page 10

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
represented by 𝑑𝑥𝑑𝑦, but also by 𝑟𝑑𝑟𝑑𝜃,
one has
න න
𝒟
𝑓 𝑥, 𝑦 𝑑𝐴 = න න
𝒟
𝑓 𝑥, 𝑦 𝑑𝑥𝑑𝑦
= න න
𝒟
ℎ 𝑟, 𝜃 𝑟𝑑𝑟𝑑𝜃
Find the volume of a cone of height
ℎ and radius 𝑅? What is a sphere's volume?
Questions 4.1 Prove that ∫-∞
∞ 𝑒-𝑥2
𝑑𝑥 = √𝜋
Questions 4.2
