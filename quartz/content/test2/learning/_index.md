---
title: "Spiking Neural Networks"
date: "2026-07-16T20:10:28.921Z"
knowledge_type: "learning-index"
breadboardType: "learning_index"
gardenId: "test2"
generatedBy: "learn_button"
generated_by: "learn_button"
learningVersion: "learning_mrny0g6u_971tlkn"
learningVersionId: "learning_mrny0g6u_971tlkn"
sourceSetHash: "4057720366b4ae7d905fa7ea8376f05cb1ec8ee45821d03953c05063636e7388"
---

# Spiking Neural Networks

Learners will be able to explain how spiking neural networks represent and process temporal information, derive their central neuron and training equations, compare learning strategies, evaluate efficiency claims, and interpret benchmark results under hardware and dataset constraints.

Read the sections in order. Start with the [[learning/Topic Overview|Topic Overview]], then work through each numbered section.

## Sections

- [[learning/1. Why Spiking Neural Networks Matters/_index|1. Why Spiking Neural Networks Matters]]
  - [[learning/1. Why Spiking Neural Networks Matters/1.1 Why Spiking Neural Networks Exist|1.1 Why Spiking Neural Networks Exist]]
- [[learning/2. From Neuron Structure to Synaptic Transmission/_index|2. From Neuron Structure to Synaptic Transmission]]
  - [[learning/2. From Neuron Structure to Synaptic Transmission/2.1 Neurons, Synapses, and Membrane Potential|2.1 Neurons, Synapses, and Membrane Potential]]
  - [[learning/2. From Neuron Structure to Synaptic Transmission/2.2 Action Potentials, Refractory Dynamics, and Spike Trains|2.2 Action Potentials, Refractory Dynamics, and Spike Trains]]
  - [[learning/2. From Neuron Structure to Synaptic Transmission/2.3 Constraint Geometry in Spiking Networks|2.3 Constraint Geometry in Spiking Networks]]
  - [[learning/2. From Neuron Structure to Synaptic Transmission/2.4 Why Spike Derivatives Need Surrogates|2.4 Why Spike Derivatives Need Surrogates]]
  - [[learning/2. From Neuron Structure to Synaptic Transmission/2.5 How Sparse Events Can Save Energy|2.5 How Sparse Events Can Save Energy]]
- [[learning/3. Describing Capacitive Membrane Current Formally/_index|3. Describing Capacitive Membrane Current Formally]]
  - [[learning/3. Describing Capacitive Membrane Current Formally/3.1 The Hodgkin-Huxley Conductance Model|3.1 The Hodgkin-Huxley Conductance Model]]
  - [[learning/3. Describing Capacitive Membrane Current Formally/3.2 The Leaky Integrate-and-Fire Neuron|3.2 The Leaky Integrate-and-Fire Neuron]]
  - [[learning/3. Describing Capacitive Membrane Current Formally/3.3 From Convex Optimization to Recurrent Voltage Dynamics|3.3 From Convex Optimization to Recurrent Voltage Dynamics]]
  - [[learning/3. Describing Capacitive Membrane Current Formally/3.4 Backpropagation Through Time|3.4 Backpropagation Through Time]]
- [[learning/4. Describing Dspike Surrogate Formally/_index|4. Describing Dspike Surrogate Formally]]
  - [[learning/4. Describing Dspike Surrogate Formally/4.1 Temperature-Controlled Differentiable Spikes|4.1 Temperature-Controlled Differentiable Spikes]]
  - [[learning/4. Describing Dspike Surrogate Formally/4.2 Information-Maximization and Finite-Difference Training|4.2 Information-Maximization and Finite-Difference Training]]
  - [[learning/4. Describing Dspike Surrogate Formally/4.3 Spike-Timing-Dependent Plasticity|4.3 Spike-Timing-Dependent Plasticity]]
  - [[learning/4. Describing Dspike Surrogate Formally/4.4 Implicit Differentiation at Equilibrium|4.4 Implicit Differentiation at Equilibrium]]
- [[learning/5. Methods and Evaluation/_index|5. Methods and Evaluation]]
  - [[learning/5. Methods and Evaluation/5.1 Training Deep Spiking Networks|5.1 Training Deep Spiking Networks]]
  - [[learning/5. Methods and Evaluation/5.2 Active-Neuron Sparsity in Training|5.2 Active-Neuron Sparsity in Training]]
- [[learning/6. Rate Encoding and Latency Encoding Compared/_index|6. Rate Encoding and Latency Encoding Compared]]
  - [[learning/6. Rate Encoding and Latency Encoding Compared/6.1 Rate, Latency, and Delta-Modulation Encoding|6.1 Rate, Latency, and Delta-Modulation Encoding]]
  - [[learning/6. Rate Encoding and Latency Encoding Compared/6.2 Online and Event-Driven Learning Rules|6.2 Online and Event-Driven Learning Rules]]
  - [[learning/6. Rate Encoding and Latency Encoding Compared/6.3 Datasets, Frameworks, and Neuromorphic Hardware|6.3 Datasets, Frameworks, and Neuromorphic Hardware]]
  - [[learning/6. Rate Encoding and Latency Encoding Compared/6.4 Interpreting SNN Benchmark Results|6.4 Interpreting SNN Benchmark Results]]
- [[learning/7. Using Memory-access Energy in Practice/_index|7. Using Memory-access Energy in Practice]]
  - [[learning/7. Using Memory-access Energy in Practice/7.1 Memory Access and Hardware Limits|7.1 Memory Access and Hardware Limits]]
  - [[learning/7. Using Memory-access Energy in Practice/7.2 Low-Power and Neuromorphic Applications|7.2 Low-Power and Neuromorphic Applications]]
  - [[learning/7. Using Memory-access Energy in Practice/7.3 Choosing an SNN Training and Evaluation Strategy|7.3 Choosing an SNN Training and Evaluation Strategy]]
