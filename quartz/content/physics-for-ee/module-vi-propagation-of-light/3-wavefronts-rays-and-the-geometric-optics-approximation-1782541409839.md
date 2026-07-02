---
title: "3) Wavefronts, rays, and the geometric-optics approximation"
date: "2026-06-27T06:23:29.839Z"
source: "user-note"
knowledge_type: "user-note"
---

## Wavefronts, rays, and the geometric-optics approximation

After carrying over the basic wave toolkit, we face a practical problem. Light is a wave, but many light problems are solved by drawing straight lines. A beam reflects from a mirror, bends at a glass surface, or passes through a prism, and we usually draw a few rays instead of drawing the full electromagnetic wave everywhere in space. That raises an important question: if light is being treated as a wave, why are we allowed to replace it by lines?

The answer begins with the idea of a **wavefront**. A wavefront is easiest to picture by thinking about one crest of a wave. In a one-dimensional drawing, a crest is just a point moving along a line. But light spreads through three-dimensional space, so all the neighboring points that are at the crest at the same instant form a surface. More generally, a wavefront is the surface made of adjacent points that are at the same phase of the wave: all crest points, all trough points, or all points at the same intermediate stage of the oscillation.

Mathematically, this is written as

$$
\Phi(\mathbf r,t)=\text{constant}.
$$

Here $\Phi$ is the phase of the wave, $\mathbf r$ is position in space, and $t$ is time. This is the mathematical centerpiece of the subsection: a wavefront is a surface of constant phase. It is not a material surface and not just a drawing convention. It is a way of identifying where the wave is at the same stage of its oscillation.

This definition also explains why two wavefronts from the same wave cannot cross. If two wavefronts of the same wave crossed, the crossing point would have to be at two different phases at the same time. That is impossible for one well-defined wave. This rule does not forbid waves from different sources from overlapping; that later case is exactly where superposition, interference, and diffraction become important. For one wave, however, its own wavefronts form a consistent family of same-phase surfaces.

For a point source sending waves outward uniformly, the wavefronts are spherical. Every point on one spherical shell is, for example, at the same crest of the wave. A little later, that crest has moved outward and forms a larger spherical shell. If we were looking from above at water waves made by dropping a stone into a pond, the wavefronts would appear as expanding circles. For a light source in three-dimensional space, the corresponding wavefronts are expanding spherical surfaces.

![pasted 1782541605749](/physics-for-ee/assets/pasted-1782541605749.png)

Once we can draw wavefronts, rays become a way to show how those wavefronts move. A **ray** points in the local direction of propagation of the wavefront. If the medium is homogeneous, its properties are the same from place to place. If it is isotropic, its properties are the same in every direction. In such a medium, the wavefronts are not continuously twisted or distorted by changes in the material, so rays are straight lines and are perpendicular to the wavefronts. For spherical wavefronts, the rays point radially outward from the source. For plane wavefronts, the rays are parallel.

This point repairs a common misunderstanding. A ray is not the “real light” while the wavefront is just an optional diagram. The ray is derived from the wave picture. It is useful because it removes most of the wave detail and keeps only the direction of travel. If the wavefront tells us “all these points are at the same phase,” the ray tells us “this is the direction in which that phase surface is advancing.”

The connection between wavefronts and rays also explains why distant sources can often be treated using plane waves. Close to a point source, the wavefronts are strongly curved spheres. Far away from that source, the radius of those spherical wavefronts is very large. If we zoom in on a small part of a huge sphere, that small patch is almost flat. In that local region, the wavefronts can be treated as parallel planes, and the rays can be treated as parallel straight lines. This is called the **plane-wave approximation**.

$$
\text{far from source: spherical wavefront patch} \approx \text{plane wavefront}.
$$

This is not an exact equation between two different objects. It is an approximation statement: over a small enough region, the curvature of a large spherical wavefront is negligible. This is why sunlight reaching a small optical setup, or a well-collimated laser beam, is often drawn as a bundle of parallel rays. The source may not truly be infinitely far away, and the wavefronts may not be perfectly plane, but the approximation is good enough when the curvature is irrelevant to the problem.

![pasted 1782541705832](/physics-for-ee/assets/pasted-1782541705832.png)

This is where **geometric optics** enters. Geometric optics is the ray description of light: instead of calculating the full wave field, we track the direction of propagation using rays. This is useful when the wave nature of light is present but not the main feature we need to calculate. A real beam has a finite width and contains many neighboring rays, but if those neighboring rays are parallel and behave in the same way, one representative ray can show the geometry. That does not mean the beam has no width; it means the omitted rays would tell the same story. The wave picture is still underneath the ray diagram.

Geometric optics therefore works best when we care mainly about the path of light rather than about detailed wave effects. It is well suited for drawing how light travels through uniform regions and how its direction changes at boundaries. But it is not the whole theory of light. When light passes through very small openings, bends around edges, or forms bright and dark patterns, the ray picture alone becomes insufficient and the wave nature must return explicitly. Those effects belong later under interference and diffraction.

So the geometric-optics approximation is not a denial that light is a wave. It is a controlled simplification of the wave picture. We started with the need to replace a complicated propagating wave by something easier to draw. That required the concept of a wavefront as a surface of constant phase. From the motion of wavefronts, rays emerged as local propagation directions, perpendicular to the wavefronts in homogeneous isotropic media. When the wavefronts are nearly plane, a beam can be represented by straight, parallel rays. This prepares the next step: using those rays to describe what happens when light meets an interface and is reflected or refracted.
