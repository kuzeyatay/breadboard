---
title: "Learning Map"
date: "2026-07-19T08:54:59.492Z"
knowledge_type: "learning-map"
breadboardType: "learning_map"
gardenId: "test2"
generatedBy: "learn_button"
generated_by: "learn_button"
learningVersion: "learning_mrrk75nd_e4hty8i"
learningVersionId: "learning_mrrk75nd_e4hty8i"
sourceSetHash: "9dd04069ae974ffd6ed432d1f1210f565e44a61dfe0994a45890c303d71157bc"
---

# Learning Map

## Section Order

- 1. Core Ideas and How They Work
  - 1.1 [[learning/1. Core Ideas and How They Work/1.1 Why Spiking Neural Networks Exist|Why Spiking Neural Networks Exist]]
  - 1.2 [[learning/1. Core Ideas and How They Work/1.2 Action Potentials and Spike Trains|Action Potentials and Spike Trains]]
  - 1.3 [[learning/1. Core Ideas and How They Work/1.3 Where SNN Efficiency Can Come From|Where SNN Efficiency Can Come From]]
- 2. Describing Capacitive Membrane Current Formally
  - 2.1 [[learning/2. Describing Capacitive Membrane Current Formally/2.1 The Hodgkin-Huxley Membrane Model|The Hodgkin-Huxley Membrane Model]]
  - 2.2 [[learning/2. Describing Capacitive Membrane Current Formally/2.2 The Leaky Integrate-and-Fire Neuron|The Leaky Integrate-and-Fire Neuron]]
  - 2.3 [[learning/2. Describing Capacitive Membrane Current Formally/2.3 Optimization Objectives and Spiking Voltage Dynamics|Optimization Objectives and Spiking Voltage Dynamics]]
  - 2.4 [[learning/2. Describing Capacitive Membrane Current Formally/2.4 Constraint Voltages and Boundary Correction|Constraint Voltages and Boundary Correction]]
  - 2.5 [[learning/2. Describing Capacitive Membrane Current Formally/2.5 Backpropagation Through Time|Backpropagation Through Time]]
- 3. Describing Non-differentiable Spike Function Formally
  - 3.1 [[learning/3. Describing Non-differentiable Spike Function Formally/3.1 Surrogate Gradients for Discrete Spikes|Surrogate Gradients for Discrete Spikes]]
  - 3.2 [[learning/3. Describing Non-differentiable Spike Function Formally/3.2 Alternative Gradient and Spike Approximations|Alternative Gradient and Spike Approximations]]
  - 3.3 [[learning/3. Describing Non-differentiable Spike Function Formally/3.3 Sparse Surrogate-Gradient Computation|Sparse Surrogate-Gradient Computation]]
  - 3.4 [[learning/3. Describing Non-differentiable Spike Function Formally/3.4 Spike-Timing-Dependent Plasticity|Spike-Timing-Dependent Plasticity]]
- 4. Methods and Evaluation
  - 4.1 [[learning/4. Methods and Evaluation/4.1 Training Deep Spiking Networks|Training Deep Spiking Networks]]
  - 4.2 [[learning/4. Methods and Evaluation/4.2 Accuracy and Benchmark Context|Accuracy and Benchmark Context]]
- 5. Rate Coding and Latency Coding Compared
  - 5.1 [[learning/5. Rate Coding and Latency Coding Compared/5.1 Rate, Latency, and Delta-Modulation Coding|Rate, Latency, and Delta-Modulation Coding]]
  - 5.2 [[learning/5. Rate Coding and Latency Coding Compared/5.2 Learning Beyond Conventional BPTT|Learning Beyond Conventional BPTT]]
  - 5.3 [[learning/5. Rate Coding and Latency Coding Compared/5.3 SNN Software and Neuromorphic Hardware|SNN Software and Neuromorphic Hardware]]
- 6. Applications, Limits, and Open Questions
  - 6.1 [[learning/6. Applications, Limits, and Open Questions/6.1 Memory Traffic as an Efficiency Bottleneck|Memory Traffic as an Efficiency Bottleneck]]
  - 6.2 [[learning/6. Applications, Limits, and Open Questions/6.2 SNNs Under Power, Heat, and Size Constraints|SNNs Under Power, Heat, and Size Constraints]]
  - 6.3 [[learning/6. Applications, Limits, and Open Questions/6.3 Event-Based Spatiotemporal Classification|Event-Based Spatiotemporal Classification]]
  - 6.4 [[learning/6. Applications, Limits, and Open Questions/6.4 Choosing an SNN Training Strategy|Choosing an SNN Training Strategy]]

## Prerequisite Chain

- Start here -> Core Ideas and How They Work
- Core Ideas and How They Work -> Describing Capacitive Membrane Current Formally
- Describing Capacitive Membrane Current Formally -> Describing Non-differentiable Spike Function Formally
- Describing Non-differentiable Spike Function Formally -> Methods and Evaluation
- Methods and Evaluation -> Rate Coding and Latency Coding Compared
- Rate Coding and Latency Coding Compared -> Applications, Limits, and Open Questions

## Trunk, Branch, Leaf Concepts

- Trunk: Core Ideas and How They Work
  - Branch/leaf: Why Spiking Neural Networks Exist
  - Branch/leaf: Action Potentials and Spike Trains
  - Branch/leaf: Where SNN Efficiency Can Come From
- Trunk: Describing Capacitive Membrane Current Formally
  - Branch/leaf: The Hodgkin-Huxley Membrane Model
  - Branch/leaf: The Leaky Integrate-and-Fire Neuron
  - Branch/leaf: Optimization Objectives and Spiking Voltage Dynamics
  - Branch/leaf: Constraint Voltages and Boundary Correction
  - Branch/leaf: Backpropagation Through Time
- Trunk: Describing Non-differentiable Spike Function Formally
  - Branch/leaf: Surrogate Gradients for Discrete Spikes
  - Branch/leaf: Alternative Gradient and Spike Approximations
  - Branch/leaf: Sparse Surrogate-Gradient Computation
  - Branch/leaf: Spike-Timing-Dependent Plasticity
- Trunk: Methods and Evaluation
  - Branch/leaf: Training Deep Spiking Networks
  - Branch/leaf: Accuracy and Benchmark Context
- Trunk: Rate Coding and Latency Coding Compared
  - Branch/leaf: Rate, Latency, and Delta-Modulation Coding
  - Branch/leaf: Learning Beyond Conventional BPTT
  - Branch/leaf: SNN Software and Neuromorphic Hardware
- Trunk: Applications, Limits, and Open Questions
  - Branch/leaf: Memory Traffic as an Efficiency Bottleneck
  - Branch/leaf: SNNs Under Power, Heat, and Size Constraints
  - Branch/leaf: Event-Based Spatiotemporal Classification
  - Branch/leaf: Choosing an SNN Training Strategy

## Bridge Concepts

- Bridges are introduced where adjacent subsections share source anchors or concept tags.

## Warnings

- The supplied source map and scope contract are truncated; planning is restricted to the visible anchors and artifact inventory.
- The event-based spatiotemporal classification topic has no dedicated anchor in the visible scope entry, so U19 uses the review title and adjacent benchmark and evaluation anchors and must remain conservative during prose generation.
- Reported efficiencies and accuracies must remain conditional on architecture, activity, encoding, training procedure, framework, hardware, and experimental configuration.
- The software and hardware ecosystem must be presented as cataloged by the review, not as a current product comparison.
- All 30 extracted source artifacts are assigned exactly once to an inline teaching unit: 5 figures or graphs in U2-U6 and U9, 24 displayed formulas in U3 and U5-U12, and the benchmark table in U20.
