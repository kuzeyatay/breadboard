"""Topology regression: nearby fillet edges must not become one mesh edge."""
from types import SimpleNamespace
import unittest

import cadquery as cq
from breadboard_cad.cadquery_engine import CadQueryModel

TETRA_FACES = [(0, 2, 1), (0, 1, 3), (1, 2, 3), (2, 0, 3)]
TETRA_POINTS = [(0, 0, 0), (1, 0, 0), (0, 1, 0), (0, 0, 1)]


def measure(points, triangles):
    shape = SimpleNamespace(tessellate=lambda *_: ([cq.Vector(*p) for p in points], triangles))
    model = SimpleNamespace(_named=[("mesh_fixture", shape)])
    return CadQueryModel.tessellate(model, 0.05, 0.1)


def adjacent_tetrahedra(offset):
    # Two closed shells have parallel edges only 0.00002 mm apart in the
    # regression fixture. Coarse positional welding falsely joins those edges.
    points = TETRA_POINTS + [(offset, 0, 0), (1 + offset, 0, 0), (offset, -1, 0), (offset, 0, -1)]
    faces = TETRA_FACES + [tuple(i + 4 for i in face) for face in TETRA_FACES]
    return points, faces


class MeshWeldingTest(unittest.TestCase):
    def test_nearby_distinct_edges_are_not_joined(self):
        result = measure(*adjacent_tetrahedra(0.00002))
        self.assertEqual(result.non_manifold_edge_count, 0)
        self.assertEqual(result.open_edge_count, 0)

    def test_face_local_vertex_copies_still_close(self):
        points, faces = [], []
        for index, face in enumerate(TETRA_FACES):
            start = len(points)
            points.extend(tuple(v + index * 1e-10 for v in TETRA_POINTS[i]) for i in face)
            faces.append((start, start + 1, start + 2))
        result = measure(points, faces)
        self.assertEqual(result.open_edge_count, 0)
        self.assertEqual(result.non_manifold_edge_count, 0)

    def test_real_shared_edge_remains_nonmanifold(self):
        result = measure(*adjacent_tetrahedra(0))
        self.assertEqual(result.non_manifold_edge_count, 1)

    def test_open_triangle_stays_open(self):
        result = measure(TETRA_POINTS[:3], [(0, 1, 2)])
        self.assertEqual(result.open_edge_count, 3)

    def test_collapsed_triangle_does_not_corrupt_edge_counts(self):
        result = measure(TETRA_POINTS, TETRA_FACES + [(0, 0, 1)])
        self.assertEqual(result.degenerate_triangle_count, 1)
        self.assertEqual(result.non_manifold_edge_count, 0)
        self.assertEqual(result.open_edge_count, 0)


if __name__ == "__main__":
    unittest.main()
