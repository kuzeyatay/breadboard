---
title: "Learning Map"
date: "2026-07-17T19:28:47.595Z"
knowledge_type: "learning-map"
breadboardType: "learning_map"
gardenId: "test2"
generatedBy: "learn_button"
generated_by: "learn_button"
learningVersion: "learning_mrpbyqf9_0sou0mq"
learningVersionId: "learning_mrpbyqf9_0sou0mq"
sourceSetHash: "9dd04069ae974ffd6ed432d1f1210f565e44a61dfe0994a45890c303d71157bc"
---

# Learning Map

## Section Order

- 1. How Spiking Neural Network Works
  - 1.1 [[learning/1. How Spiking Neural Network Works/1.1 Why Spiking Neural Networks Exist|Why Spiking Neural Networks Exist]]
  - 1.2 [[learning/1. How Spiking Neural Network Works/1.2 Neurons, Synapses, and Action Potentials|Neurons, Synapses, and Action Potentials]]
  - 1.3 [[learning/1. How Spiking Neural Network Works/1.3 Why Hard Spikes Break Ordinary Gradients|Why Hard Spikes Break Ordinary Gradients]]
  - 1.4 [[learning/1. How Spiking Neural Network Works/1.4 Where SNN Efficiency Comes From|Where SNN Efficiency Comes From]]
- 2. Describing Capacitive Current Formally
  - 2.1 [[learning/2. Describing Capacitive Current Formally/2.1 The Hodgkin-Huxley Membrane Equation|The Hodgkin-Huxley Membrane Equation]]
  - 2.2 [[learning/2. Describing Capacitive Current Formally/2.2 Leaky Integration of Synaptic Input|Leaky Integration of Synaptic Input]]
  - 2.3 [[learning/2. Describing Capacitive Current Formally/2.3 Threshold Crossing, Spiking, and Reset|Threshold Crossing, Spiking, and Reset]]
  - 2.4 [[learning/2. Describing Capacitive Current Formally/2.4 Voltage Dynamics Across a Spiking Network|Voltage Dynamics Across a Spiking Network]]
  - 2.5 [[learning/2. Describing Capacitive Current Formally/2.5 A Quadratic Objective with Linear Constraints|A Quadratic Objective with Linear Constraints]]
- 3. Describing Gradient-descent Dynamics Formally
  - 3.1 [[learning/3. Describing Gradient-descent Dynamics Formally/3.1 From Constrained Descent to Spiking Dynamics|From Constrained Descent to Spiking Dynamics]]
  - 3.2 [[learning/3. Describing Gradient-descent Dynamics Formally/3.2 Temporal Credit Assignment with BPTT|Temporal Credit Assignment with BPTT]]
  - 3.3 [[learning/3. Describing Gradient-descent Dynamics Formally/3.3 Piecewise Surrogate Gradients|Piecewise Surrogate Gradients]]
  - 3.4 [[learning/3. Describing Gradient-descent Dynamics Formally/3.4 Finite-Difference Gradient Estimation|Finite-Difference Gradient Estimation]]
  - 3.5 [[learning/3. Describing Gradient-descent Dynamics Formally/3.5 Information-Maximizing Spike Objectives|Information-Maximizing Spike Objectives]]
- 4. Describing Differentiable Spike Activation Formally
  - 4.1 [[learning/4. Describing Differentiable Spike Activation Formally/4.1 Differentiable Spikes with Evolving Sharpness|Differentiable Spikes with Evolving Sharpness]]
  - 4.2 [[learning/4. Describing Differentiable Spike Activation Formally/4.2 Sparse Surrogate-Gradient Updates|Sparse Surrogate-Gradient Updates]]
  - 4.3 [[learning/4. Describing Differentiable Spike Activation Formally/4.3 Spike-Timing-Dependent Plasticity|Spike-Timing-Dependent Plasticity]]
  - 4.4 [[learning/4. Describing Differentiable Spike Activation Formally/4.4 Stabilizing Deep Spiking Networks|Stabilizing Deep Spiking Networks]]
- 5. Rate Coding and Latency Coding Compared
  - 5.1 [[learning/5. Rate Coding and Latency Coding Compared/5.1 Rate, Latency, and Delta Spike Encoding|Rate, Latency, and Delta Spike Encoding]]
  - 5.2 [[learning/5. Rate Coding and Latency Coding Compared/5.2 Alternatives to Standard BPTT|Alternatives to Standard BPTT]]
  - 5.3 [[learning/5. Rate Coding and Latency Coding Compared/5.3 Interpreting SNN Benchmarks Responsibly|Interpreting SNN Benchmarks Responsibly]]
  - 5.4 [[learning/5. Rate Coding and Latency Coding Compared/5.4 SNN Frameworks, Hardware, and Low-Power Applications|SNN Frameworks, Hardware, and Low-Power Applications]]

## Prerequisite Chain

- Start here -> How Spiking Neural Network Works
- How Spiking Neural Network Works -> Describing Capacitive Current Formally
- Describing Capacitive Current Formally -> Describing Gradient-descent Dynamics Formally
- Describing Gradient-descent Dynamics Formally -> Describing Differentiable Spike Activation Formally
- Describing Differentiable Spike Activation Formally -> Rate Coding and Latency Coding Compared

## Trunk, Branch, Leaf Concepts

- Trunk: How Spiking Neural Network Works
  - Branch/leaf: Why Spiking Neural Networks Exist
  - Branch/leaf: Neurons, Synapses, and Action Potentials
  - Branch/leaf: Why Hard Spikes Break Ordinary Gradients
  - Branch/leaf: Where SNN Efficiency Comes From
- Trunk: Describing Capacitive Current Formally
  - Branch/leaf: The Hodgkin-Huxley Membrane Equation
  - Branch/leaf: Leaky Integration of Synaptic Input
  - Branch/leaf: Threshold Crossing, Spiking, and Reset
  - Branch/leaf: Voltage Dynamics Across a Spiking Network
  - Branch/leaf: A Quadratic Objective with Linear Constraints
- Trunk: Describing Gradient-descent Dynamics Formally
  - Branch/leaf: From Constrained Descent to Spiking Dynamics
  - Branch/leaf: Temporal Credit Assignment with BPTT
  - Branch/leaf: Piecewise Surrogate Gradients
  - Branch/leaf: Finite-Difference Gradient Estimation
  - Branch/leaf: Information-Maximizing Spike Objectives
- Trunk: Describing Differentiable Spike Activation Formally
  - Branch/leaf: Differentiable Spikes with Evolving Sharpness
  - Branch/leaf: Sparse Surrogate-Gradient Updates
  - Branch/leaf: Spike-Timing-Dependent Plasticity
  - Branch/leaf: Stabilizing Deep Spiking Networks
- Trunk: Rate Coding and Latency Coding Compared
  - Branch/leaf: Rate, Latency, and Delta Spike Encoding
  - Branch/leaf: Alternatives to Standard BPTT
  - Branch/leaf: Interpreting SNN Benchmarks Responsibly
  - Branch/leaf: SNN Frameworks, Hardware, and Low-Power Applications

## Bridge Concepts

- Bridges are introduced where adjacent subsections share source anchors or concept tags.

## Warnings

- The contract is grounded in one review article; claims should retain the review's framing and should not be presented as independent experimental verification.
- The provided source map is compacted, so page and artifact anchors should be checked against the full extracted document before long-form generation.
- Reported benchmark accuracies are configuration-dependent and must not be converted into a universal ranking.
- Potential energy efficiency depends on event sparsity, memory traffic, software behavior, and compatible hardware; spike sparsity alone is insufficient.
- The constrained-optimizer interpretation should be taught as the reviewed mathematical correspondence, not as a claim that every SNN implements every constrained optimization problem.
- Illustrative numerical examples may clarify equations but must be labeled as constructed examples rather than reported experimental results.
- All identified figures, graphs, displayed formulas, and the benchmark table are assigned exactly once to an inline teaching unit; none are reserved for a disconnected artifact gallery.
