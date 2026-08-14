"""Deterministic geometry and printability validation.

Every check here is a measurement, not a judgement. It runs against the solid
OpenCascade actually produced, so "the source looked right" is never enough for
a part to be reported as validated.

What this cannot do is stated as plainly as what it can: wall-thickness is
checked from the design's declared value against measurable geometry, not by a
true medial-axis thickness analysis, and nothing here is a structural
assessment. Both limits are surfaced to the user in the validation panel.
"""

from __future__ import annotations

import math

from .models import (
    BoundingBox,
    SolidSummary,
    TessellationSummary,
    ValidationExpectations,
    ValidationIssue,
)

#: Below this a "solid" is a modelling accident rather than a part.
MINIMUM_MEANINGFUL_VOLUME_MM3 = 1e-6


def _issue(
    code: str,
    severity: str,
    message: str,
    *,
    feature: str | None = None,
    expected: object | None = None,
    actual: object | None = None,
    repair_hint: str | None = None,
) -> ValidationIssue:
    return ValidationIssue(
        code=code,
        severity=severity,  # type: ignore[arg-type]
        message=message,
        feature=feature,
        expected=expected,
        actual=actual,
        repairHint=repair_hint,
    )


def _finite(*values: float) -> bool:
    return all(math.isfinite(value) for value in values)


def validate_model(
    solids: list[SolidSummary],
    bounding_box: BoundingBox | None,
    tessellation: TessellationSummary | None,
    expectations: ValidationExpectations,
    exported_formats: list[str],
    interferences: list[tuple[str, str, float]] | None = None,
) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []

    # ---- topology -------------------------------------------------------
    if not solids:
        return [
            _issue(
                "no_solid",
                "error",
                "The program produced no solid body.",
                repair_hint="Return at least one closed solid from build_model.",
            )
        ]

    if expectations.expected_solid_count is not None and len(solids) != expectations.expected_solid_count:
        issues.append(
            _issue(
                "solid_count_mismatch",
                "error",
                f"The design declares {expectations.expected_solid_count} bodies but "
                f"{len(solids)} were produced.",
                expected=expectations.expected_solid_count,
                actual=len(solids),
                repair_hint="Return one named solid per declared component, or correct the "
                "component list in the design specification.",
            )
        )

    for solid in solids:
        if not solid.valid:
            issues.append(
                _issue(
                    "invalid_shape",
                    "error",
                    f"OpenCascade reports the body '{solid.name}' as an invalid shape.",
                    feature=solid.name,
                    repair_hint="A self-intersecting boolean or an over-large fillet usually "
                    "causes this. Reduce the fillet radius or split the operation.",
                )
            )
        if not solid.watertight:
            issues.append(
                _issue(
                    "not_watertight",
                    "error",
                    f"The body '{solid.name}' is not a closed, watertight volume, so it cannot be sliced for printing.",
                    feature=solid.name,
                    repair_hint="Build the body from closed operations rather than loose faces or shells.",
                )
            )
        if solid.volume <= MINIMUM_MEANINGFUL_VOLUME_MM3:
            issues.append(
                _issue(
                    "degenerate_solid",
                    "error",
                    f"The body '{solid.name}' has effectively no volume ({solid.volume:.6g} mm^3).",
                    feature=solid.name,
                    actual=solid.volume,
                    repair_hint="A cut removed the whole body, or a dimension resolved to zero.",
                )
            )
        solid_box = solid.bounding_box
        if not _finite(
            solid_box.x,
            solid_box.y,
            solid_box.z,
            solid.volume,
            solid.surface_area,
        ):
            issues.append(
                _issue(
                    "non_finite_geometry",
                    "error",
                    f"The body '{solid.name}' has non-finite coordinates or measurements.",
                    feature=solid.name,
                    repair_hint="Check the arithmetic that derives this body's dimensions.",
                )
            )

    # ---- multi-body assembly -------------------------------------------
    # Each body can be watertight and still occupy the same material volume
    # as another body. That is not an assembly; it is a collision hidden by
    # validating the parts one at a time.
    for left, right, volume in interferences or []:
        issues.append(
            _issue(
                "assembly_interference",
                "error",
                f"The bodies '{left}' and '{right}' overlap by {volume:.4f} mm^3 in assembled coordinates.",
                feature=f"{left} <-> {right}",
                expected=0,
                actual=volume,
                repair_hint="Move or reshape the bodies so rigid parts have clearance or only intentional zero-volume contact.",
            )
        )

    if bounding_box is None:
        return issues

    # ---- disconnected bodies -------------------------------------------
    if len(solids) > 1:
        detached = _detached_bodies(solids)
        if detached:
            issues.append(
                _issue(
                    "disconnected_bodies",
                    "warning",
                    "These bodies do not touch or overlap any other body: "
                    + ", ".join(detached)
                    + ". That is expected for a lid or a separate part, and a defect if the "
                    "design meant them to be one piece.",
                    actual=detached,
                    repair_hint="If they should be one piece, union them; if they are separate "
                    "printable parts, list each one as a component in the design specification.",
                )
            )

    # ---- declared dimensions -------------------------------------------
    if expectations.bounding_box:
        tolerance = expectations.bounding_box_tolerance
        for axis in ("x", "y", "z"):
            declared = expectations.bounding_box.get(axis)
            if declared is None:
                continue
            measured = getattr(bounding_box, axis)
            if abs(measured - declared) > tolerance:
                issues.append(
                    _issue(
                        "bounding_box_mismatch",
                        "error",
                        f"The overall {axis.upper()} size is {measured:.2f} mm but the design "
                        f"declares {declared:.2f} mm (tolerance ±{tolerance} mm).",
                        feature=f"boundingBox.{axis}",
                        expected=declared,
                        actual=round(measured, 3),
                        repair_hint="Either the geometry or the declared dimension is wrong. "
                        "Outer size usually equals the internal size plus two wall thicknesses.",
                    )
                )

    # ---- printability ---------------------------------------------------
    minimum_feature = expectations.minimum_feature_size
    if minimum_feature > 0:
        for solid in solids:
            box = solid.bounding_box
            smallest = min(box.x, box.y, box.z)
            if smallest < minimum_feature:
                issues.append(
                    _issue(
                        "feature_below_minimum",
                        "warning",
                        f"The body '{solid.name}' is only {smallest:.2f} mm across its thinnest "
                        f"axis, below the {minimum_feature} mm minimum feature size for this "
                        "process.",
                        feature=solid.name,
                        expected=minimum_feature,
                        actual=round(smallest, 3),
                        repair_hint="Thicken the body or raise the minimum feature size if the "
                        "process really can hold it.",
                    )
                )

    wall = expectations.minimum_wall_thickness
    if wall is not None:
        if wall < minimum_feature:
            issues.append(
                _issue(
                    "wall_below_minimum_feature",
                    "error",
                    f"The declared wall thickness of {wall} mm is below the {minimum_feature} mm "
                    "minimum feature size for this process.",
                    feature="wallThickness",
                    expected=minimum_feature,
                    actual=wall,
                    repair_hint="Raise the wall thickness to at least the minimum feature size.",
                )
            )
        # A hollowing operation that silently did nothing is the failure mode
        # this catches. OpenCascade's `shell` returns the original solid rather
        # than raising when the requested thickness leaves nothing to remove, so
        # a request for a walled enclosure can come back as a solid brick that
        # passes every topology check.
        #
        # The rule is one comparison: the body completely fills its bounding box
        # while the declared wall is thinner than the box's smallest dimension.
        # A flat plate whose thickness *is* its declared wall is solid on
        # purpose, and never trips it.
        smallest_extent = min(bounding_box.x, bounding_box.y, bounding_box.z)
        box_volume = bounding_box.x * bounding_box.y * bounding_box.z
        measured_volume = sum(solid.volume for solid in solids)
        if (
            box_volume > 0
            and smallest_extent > wall * (1 + 1e-6)
            and abs(measured_volume - box_volume) / box_volume < 1e-6
        ):
            issues.append(
                _issue(
                    "hollowing_had_no_effect",
                    "error",
                    f"The design declares {wall} mm walls, but the body completely fills its "
                    f"{bounding_box.x:.1f} × {bounding_box.y:.1f} × {bounding_box.z:.1f} mm "
                    "envelope — nothing was hollowed out.",
                    feature="wallThickness",
                    expected=wall,
                    actual=round(measured_volume, 3),
                    repair_hint="`shell` returns the original solid instead of raising when the "
                    "requested thickness leaves nothing to remove — a wall of more than half the "
                    "smallest dimension always does. Reduce the wall thickness, or cut the cavity "
                    "explicitly.",
                )
            )
        issues.append(
            _issue(
                "wall_thickness_declared",
                "info",
                f"Wall thickness is checked against the declared value of {wall} mm. This is not "
                "a medial-axis thickness analysis: a wall thinned by an unrelated cut would not "
                "be detected.",
                feature="wallThickness",
                expected=wall,
            )
        )

    for index, diameter in enumerate(expectations.hole_diameters):
        if diameter <= 0 or not math.isfinite(diameter):
            issues.append(
                _issue(
                    "invalid_hole_diameter",
                    "error",
                    f"Hole {index + 1} has a diameter of {diameter}, which is not a usable size.",
                    feature=f"hole[{index}]",
                    actual=diameter,
                )
            )
        elif diameter < minimum_feature:
            issues.append(
                _issue(
                    "hole_below_minimum",
                    "warning",
                    f"A {diameter} mm hole is below the {minimum_feature} mm minimum feature "
                    "size and is likely to print closed.",
                    feature=f"hole[{index}]",
                    expected=minimum_feature,
                    actual=diameter,
                    repair_hint="Enlarge the hole, or drill it after printing.",
                )
            )

    for index, clearance in enumerate(expectations.clearances):
        if clearance < 0 or not math.isfinite(clearance):
            issues.append(
                _issue(
                    "invalid_clearance",
                    "error",
                    f"Clearance {index + 1} is {clearance}, which is not a usable value.",
                    feature=f"clearance[{index}]",
                    actual=clearance,
                )
            )
        elif clearance < 0.1:
            issues.append(
                _issue(
                    "clearance_too_tight",
                    "warning",
                    f"A {clearance} mm clearance is tighter than an FDM printer usually holds; "
                    "the parts are likely to fuse.",
                    feature=f"clearance[{index}]",
                    actual=clearance,
                    repair_hint="0.15 mm is a press fit, 0.3 mm a general fit, 0.35 mm a sliding "
                    "fit on a well-tuned printer.",
                )
            )

    bed = expectations.printer_bed
    if bed:
        for axis in ("x", "y", "z"):
            limit = bed.get(axis)
            if limit is None:
                continue
            measured = getattr(bounding_box, axis)
            if measured > limit:
                issues.append(
                    _issue(
                        "exceeds_printer_bed",
                        "error",
                        f"The part is {measured:.1f} mm in {axis.upper()}, larger than the "
                        f"configured {limit:.0f} mm bed.",
                        feature=f"printerBed.{axis}",
                        expected=limit,
                        actual=round(measured, 2),
                        repair_hint="Shrink the part, split it into printable sections, or raise "
                        "the configured bed size.",
                    )
                )

    # ---- mesh ------------------------------------------------------------
    if tessellation:
        if tessellation.triangle_count == 0:
            issues.append(
                _issue(
                    "tessellation_empty",
                    "error",
                    "The solid produced no triangles, so no printable mesh can be exported.",
                )
            )
        if tessellation.has_non_finite_coordinates:
            issues.append(
                _issue(
                    "mesh_non_finite",
                    "error",
                    "The exported mesh contains NaN or infinite coordinates.",
                )
            )
        if tessellation.degenerate_triangle_count:
            issues.append(
                _issue(
                    "degenerate_triangles",
                    "warning",
                    f"{tessellation.degenerate_triangle_count} degenerate triangles are present "
                    "in the mesh. Most slicers drop them, but they signal near-tangent geometry.",
                    actual=tessellation.degenerate_triangle_count,
                    repair_hint="Usually a fillet whose radius nearly equals the wall it sits on.",
                )
            )
        if tessellation.non_manifold_edge_count:
            issues.append(
                _issue(
                    "non_manifold_mesh",
                    "error",
                    f"{tessellation.non_manifold_edge_count} mesh edges are shared by more than "
                    "two triangles, which is not a printable manifold.",
                    actual=tessellation.non_manifold_edge_count,
                    repair_hint="Two bodies are touching exactly face-to-face. Union them or "
                    "give them a real clearance.",
                )
            )
        if tessellation.open_edge_count:
            issues.append(
                _issue(
                    "open_mesh_edges",
                    "error",
                    f"{tessellation.open_edge_count} mesh edges belong to only one triangle, so "
                    "the exported mesh has holes.",
                    actual=tessellation.open_edge_count,
                    repair_hint="Coarsen the tessellation tolerance, or rebuild the body from "
                    "closed operations.",
                )
            )

    if "stl" not in exported_formats:
        issues.append(
            _issue(
                "stl_not_exported",
                "warning",
                "No STL was exported, so slicing was not verified.",
            )
        )

    if expectations.units != "mm":
        issues.append(
            _issue(
                "units_not_millimetres",
                "info",
                f"The design declares {expectations.units}. Geometry and every measurement here "
                "are in millimetres; conversion happens in the design specification only.",
                expected="mm",
                actual=expectations.units,
            )
        )

    return issues


def _detached_bodies(solids: list[SolidSummary]) -> list[str]:
    """Bodies whose bounding boxes touch no other body's.

    Bounding-box overlap is a conservative proxy: it never reports a body that
    genuinely touches another, and it can miss two interlocking shapes whose
    boxes overlap without the solids meeting. Reporting it as a warning rather
    than an error is what keeps that approximation honest.
    """
    detached: list[str] = []
    for index, solid in enumerate(solids):
        overlaps = any(
            _boxes_touch(solid.bounding_box, other.bounding_box)
            for position, other in enumerate(solids)
            if position != index
        )
        if not overlaps:
            detached.append(solid.name)
    return detached


def _boxes_touch(left: BoundingBox, right: BoundingBox, tolerance: float = 1e-6) -> bool:
    return (
        left.xmin <= right.xmax + tolerance
        and right.xmin <= left.xmax + tolerance
        and left.ymin <= right.ymax + tolerance
        and right.ymin <= left.ymax + tolerance
        and left.zmin <= right.zmax + tolerance
        and right.zmin <= left.zmax + tolerance
    )


def passed(issues: list[ValidationIssue]) -> bool:
    return not any(issue.severity == "error" for issue in issues)
