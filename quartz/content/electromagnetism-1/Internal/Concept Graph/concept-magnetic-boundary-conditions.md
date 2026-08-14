---
title: "Magnetic Boundary Conditions"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "magnetic-boundary-conditions"
locations: ["Page 266", "Page 267", "Page 268", "Page 269", "Section 8.7", "Figure 8.10", "Example 8.6", "Problem D8.8"]
related: ["free-bound-and-total-magnetic-currents", "linear-magnetic-constitutive-relations", "magnetic-circuit-analogy-and-reluctance"]
---

## ConceptNode: Magnetic Boundary Conditions

Planning node for [[magnetic-boundary-conditions|1.123 Magnetic Boundary Conditions]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 266, Page 267, Page 268, Page 269, Section 8.7, Figure 8.10, Example 8.6, Problem D8.8

At an interface between two homogeneous linear isotropic magnetic media, the normal and tangential field components obey different continuity laws. Applying Gauss's law for magnetism to a thin pillbox gives $(\mathbf{B}_2-\mathbf{B}_1)\cdot\mathbf{a}_{N12}=0$, so the normal component of $\mathbf{B}$ is continuous. Since $\mathbf{B}=\mu\mathbf{H}$, the normal field intensity changes according to $H_{N2}=(\mu_1/\mu_2)H_{N1}$. Applying Ampère's law to a small loop crossing the interface gives $(\mathbf{H}_1-\mathbf{H}_2)\times\mathbf{a}_{N12}=\mathbf{K}$, where $\mathbf{K}$ is the free surface current density. Equivalently, $\mathbf{H}_{t1}-\mathbf{H}_{t2}=\mathbf{a}_{N12}\times\mathbf{K}$. The tangential flux densities satisfy $B_{t1}/\mu_1-B_{t2}/\mu_2=K$ in the scalar orientation used by the source. If no free surface current exists, tangential $\mathbf{H}$ is continuous. Example 8.6 demonstrates the vector procedure: split the known field into normal and tangential parts, preserve normal $\mathbf{B}$, apply the surface-current jump to tangential $\mathbf{H}$, and reconstruct the unknown $\mathbf{B}$.

### Key planning details

- The normal component of $\mathbf{B}$ is continuous across every magnetic interface.
- The normal component of $\mathbf{H}$ changes inversely with permeability.
- The normal condition is $(\mathbf{B}_2-\mathbf{B}_1)\cdot\mathbf{a}_{N12}=0$.
- A free surface current creates a jump in tangential $\mathbf{H}$.
- The vector jump condition is $(\mathbf{H}_1-\mathbf{H}_2)\times\mathbf{a}_{N12}=\mathbf{K}$.
- If $\mathbf{K}=0$, tangential $\mathbf{H}$ is continuous.
- Tangential $\mathbf{B}$ need not be continuous when permeabilities differ.
- Field reconstruction requires careful use of the interface-normal direction.

### Source coverage

- Figure S13.P266.F8.10 shows the Gaussian pillbox and Ampèrian loop used to derive both interface conditions.
- Equation (32) gives $(\mathbf{B}_2-\mathbf{B}_1)\cdot\mathbf{a}_{N12}=0$.
- Equation (33) gives $H_{N2}=(\mu_1/\mu_2)H_{N1}$.
- Equation (35) gives $(\mathbf{H}_1-\mathbf{H}_2)\times\mathbf{a}_{N12}=\mathbf{K}$.
- Equations (34) and (37) give the corresponding normal and tangential magnetization relationships for linear materials.
- Example 8.6 obtains $\mathbf{B}_2=(3.5\mathbf{a}_x-4.69\mathbf{a}_y+\mathbf{a}_z)$ mT from $\mathbf{B}_1$, $\mu_1$, $\mu_2$, and $\mathbf{K}$.
- Problem D8.8 asks for normal and tangential field magnitudes on both sides of a current-carrying interface.
