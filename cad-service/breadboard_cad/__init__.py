"""Breadboard's local parametric CAD service.

The package is deliberately split so that nothing which touches model-generated
source runs in the same process as the HTTP server:

``guard``      static (AST) admission control for generated source
``executor``   process supervision — temp workdir, timeout, tree kill, caps
``worker``     the child process entry point that actually builds geometry
``engine``     the CAD engine protocol
``cadquery_engine``  the CadQuery/OpenCascade implementation
``validation`` deterministic geometry and printability checks
``server``     loopback HTTP surface with bearer authentication
"""

SERVICE_VERSION = "1.0.0"
SCHEMA_VERSION = 1

__all__ = ["SERVICE_VERSION", "SCHEMA_VERSION"]
