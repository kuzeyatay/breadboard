---
title: "Mutual Force, Linearity, and Superposition"
date: "2026-08-13T12:06:57.818Z"
source: "upload"
knowledge_type: "internal-concept"
breadboardType: "internal_concept"
draft: "true"
source_document: "engineering-electromagnetics-9th-ed-9nbsped-compress"
source_file: "engineering-electromagnetics-9th-ed-9nbsped_compress.pdf"
learning_page: "mutual-force-linearity-and-superposition"
locations: ["Page 40", "Equation (5)", "Page 41", "Problem D2.1"]
related: ["coulombs-experimental-inverse-square-law", "vector-form-of-coulombs-law", "electric-field-superposition-from-multiple-point-charges"]
---

## ConceptNode: Mutual Force, Linearity, and Superposition

Planning node for [[mutual-force-linearity-and-superposition|1.33 Mutual Force, Linearity, and Superposition]].

Source: [[engineering-electromagnetics-9th-ed-9nbsped-compress|Engineering Electromagnetics, Ninth Edition: Learning Spine and Vector Analysis Foundations]]

Locations: Page 40, Equation (5), Page 41, Problem D2.1

Electrostatic force between two point charges is mutual: the forces have equal magnitudes and opposite directions. In the source notation, $\mathbf{a}_{21}=-\mathbf{a}_{12}$ and therefore $$\mathbf{F}_1=-\mathbf{F}_2.$$ Coulomb's law is also linear in each charge. Multiplying one source charge by a factor $n$ multiplies the resulting force by the same factor. This linearity permits superposition: when several charges are present, the force on a selected charge is the vector sum of the forces produced by each other charge acting alone. Superposition preserves direction, so individual force vectors must be computed before they are added. This principle becomes the direct basis for electric-field superposition, where the field contributions of multiple source charges are added at a common observation point. Problem D2.1 reinforces the directed-displacement and force calculation using two charges at arbitrary rectangular-coordinate locations.

### Key planning details

- The force on $Q_1$ is equal and opposite to the force on $Q_2$.
- $\mathbf{a}_{21}=-\mathbf{a}_{12}$.
- Scaling a charge scales the force by the same factor.
- For multiple charges, compute each pairwise contribution independently.
- Add force contributions as vectors, not as unsigned magnitudes.
- Do not include the selected charge's force on itself.
- Force superposition leads directly to electric-field superposition.

### Source coverage

- Equation (5) states $\mathbf{F}_1=-\mathbf{F}_2$.
- The text calls Coulomb's force a mutual force.
- The text states that multiplying $Q_1$ by $n$ multiplies the force on $Q_2$ by $n$.
- The force in the presence of several charges is described as the sum of forces from the charges acting alone.
- D2.1 specifies charges at A and B and asks for the displacement, separation, and force using two values of $\epsilon_0$.
- D2.1 reports closely matching force components for the exact and approximate permittivity values.
