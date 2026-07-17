---
title: "Spiking Neural Networks"
date: "2026-07-17T19:28:47.586Z"
knowledge_type: "learning-index"
breadboardType: "learning_index"
gardenId: "test2"
generatedBy: "learn_button"
generated_by: "learn_button"
learningVersion: "learning_mrpbyqf9_0sou0mq"
learningVersionId: "learning_mrpbyqf9_0sou0mq"
sourceSetHash: "9dd04069ae974ffd6ed432d1f1210f565e44a61dfe0994a45890c303d71157bc"
---

# Spiking Neural Networks

Learners will be able to explain how spike-based computation grows from biological signaling, derive central neuron and optimization equations, compare encoding and training strategies, analyze efficiency mechanisms, and interpret SNN benchmarks without making unsupported universal claims.

Read the sections in order. Start with the [[learning/Topic Overview|Topic Overview]], then work through each numbered section.

## Sections

- [[learning/1. How Spiking Neural Network Works/_index|1. How Spiking Neural Network Works]]
  - [[learning/1. How Spiking Neural Network Works/1.1 Why Spiking Neural Networks Exist|1.1 Why Spiking Neural Networks Exist]]
  - [[learning/1. How Spiking Neural Network Works/1.2 Neurons, Synapses, and Action Potentials|1.2 Neurons, Synapses, and Action Potentials]]
  - [[learning/1. How Spiking Neural Network Works/1.3 Why Hard Spikes Break Ordinary Gradients|1.3 Why Hard Spikes Break Ordinary Gradients]]
  - [[learning/1. How Spiking Neural Network Works/1.4 Where SNN Efficiency Comes From|1.4 Where SNN Efficiency Comes From]]
- [[learning/2. Describing Capacitive Current Formally/_index|2. Describing Capacitive Current Formally]]
  - [[learning/2. Describing Capacitive Current Formally/2.1 The Hodgkin-Huxley Membrane Equation|2.1 The Hodgkin-Huxley Membrane Equation]]
  - [[learning/2. Describing Capacitive Current Formally/2.2 Leaky Integration of Synaptic Input|2.2 Leaky Integration of Synaptic Input]]
  - [[learning/2. Describing Capacitive Current Formally/2.3 Threshold Crossing, Spiking, and Reset|2.3 Threshold Crossing, Spiking, and Reset]]
  - [[learning/2. Describing Capacitive Current Formally/2.4 Voltage Dynamics Across a Spiking Network|2.4 Voltage Dynamics Across a Spiking Network]]
  - [[learning/2. Describing Capacitive Current Formally/2.5 A Quadratic Objective with Linear Constraints|2.5 A Quadratic Objective with Linear Constraints]]
- [[learning/3. Describing Gradient-descent Dynamics Formally/_index|3. Describing Gradient-descent Dynamics Formally]]
  - [[learning/3. Describing Gradient-descent Dynamics Formally/3.1 From Constrained Descent to Spiking Dynamics|3.1 From Constrained Descent to Spiking Dynamics]]
  - [[learning/3. Describing Gradient-descent Dynamics Formally/3.2 Temporal Credit Assignment with BPTT|3.2 Temporal Credit Assignment with BPTT]]
  - [[learning/3. Describing Gradient-descent Dynamics Formally/3.3 Piecewise Surrogate Gradients|3.3 Piecewise Surrogate Gradients]]
  - [[learning/3. Describing Gradient-descent Dynamics Formally/3.4 Finite-Difference Gradient Estimation|3.4 Finite-Difference Gradient Estimation]]
  - [[learning/3. Describing Gradient-descent Dynamics Formally/3.5 Information-Maximizing Spike Objectives|3.5 Information-Maximizing Spike Objectives]]
- [[learning/4. Describing Differentiable Spike Activation Formally/_index|4. Describing Differentiable Spike Activation Formally]]
  - [[learning/4. Describing Differentiable Spike Activation Formally/4.1 Differentiable Spikes with Evolving Sharpness|4.1 Differentiable Spikes with Evolving Sharpness]]
  - [[learning/4. Describing Differentiable Spike Activation Formally/4.2 Sparse Surrogate-Gradient Updates|4.2 Sparse Surrogate-Gradient Updates]]
  - [[learning/4. Describing Differentiable Spike Activation Formally/4.3 Spike-Timing-Dependent Plasticity|4.3 Spike-Timing-Dependent Plasticity]]
  - [[learning/4. Describing Differentiable Spike Activation Formally/4.4 Stabilizing Deep Spiking Networks|4.4 Stabilizing Deep Spiking Networks]]
- [[learning/5. Rate Coding and Latency Coding Compared/_index|5. Rate Coding and Latency Coding Compared]]
  - [[learning/5. Rate Coding and Latency Coding Compared/5.1 Rate, Latency, and Delta Spike Encoding|5.1 Rate, Latency, and Delta Spike Encoding]]
  - [[learning/5. Rate Coding and Latency Coding Compared/5.2 Alternatives to Standard BPTT|5.2 Alternatives to Standard BPTT]]
  - [[learning/5. Rate Coding and Latency Coding Compared/5.3 Interpreting SNN Benchmarks Responsibly|5.3 Interpreting SNN Benchmarks Responsibly]]
  - [[learning/5. Rate Coding and Latency Coding Compared/5.4 SNN Frameworks, Hardware, and Low-Power Applications|5.4 SNN Frameworks, Hardware, and Low-Power Applications]]
