from dataclasses import replace

import pytest
from test_control_gestures import FIST, OPEN, SCROLL, V, pose_hand
from test_monitors import native  # noqa: F401 -- reusable isolated Windows fixture.

from aircursor.app_context import AppContext
from aircursor.cad_profiles import PROFILES, detect_profile
from aircursor.hand_geometry import finger_openness, palm_angles, pinch_distance
from aircursor.held_scroll import HeldScroll
from aircursor.models import Point
from aircursor.navigation import Navigation


def bent_hand():
    points = list(OPEN.landmarks)
    for base in (5, 9, 13, 17):
        for joint, amount in ((1, 0.12), (2, 0.22), (3, 0.28)):
            points[base + joint] = Point(points[base].x - amount, points[base].y)
    return replace(OPEN, landmarks=tuple(points))


BENT = bent_hand()
RELAXED = pose_hand((5,))
CONTEXT = AppContext(100, r"C:\Apps\blender.exe", "Blender", (-1920, 0, 0, 1080))


class Recorder:
    def __init__(self):
        self.wheel = []
        self.rotations = []
        self.allowed = True
        self.releases = 0

    def scroll_units(self, units):
        self.wheel.append(units)

    def scroll(self, notches):
        self.wheel.append(notches * 120)

    def navigation_allowed(self, *_):
        return self.allowed

    def orbit(self, profile, window, bounds, dx, dy):
        self.rotations.append((profile, dx, dy))

    def end_navigation(self):
        self.releases += 1

    def refresh_navigation(self):
        pass


@pytest.mark.parametrize("hand,sign", [(BENT, -1), (OPEN, 1)])
@pytest.mark.parametrize("fps", [15, 30, 60])
def test_held_shape_scrolls_at_fixed_rate_until_released(hand, sign, fps):
    recorder = Recorder()
    scroll = HeldScroll(recorder)
    for i in range(round(1.2 * fps) + 1):
        assert scroll.update(hand, i / fps).blocks_mouse
    assert sum(recorder.wheel) == pytest.approx(sign * 480, abs=2)
    before = list(recorder.wheel)
    for pose in (RELAXED, V, FIST, None):
        assert not scroll.update(pose, 1.3).blocks_mouse
    assert recorder.wheel == before


def test_scroll_direction_changes_reconfirm_and_camera_gaps_do_not_burst():
    recorder = Recorder()
    scroll = HeldScroll(recorder)
    for i in range(15):
        scroll.update(BENT, i * 0.04)
    assert sum(recorder.wheel) < 0
    recorder.wheel.clear()
    for i in range(15, 19):
        scroll.update(OPEN, i * 0.04)
    assert recorder.wheel == []
    for i in range(19, 30):
        scroll.update(OPEN, i * 0.04)
    assert sum(recorder.wheel) > 0
    recorder.wheel.clear()
    scroll.update(OPEN, 5.0)
    scroll.update(OPEN, 5.1)
    assert recorder.wheel == []


def test_knuckle_fold_is_distinct_from_curling_into_a_fist():
    assert finger_openness(BENT) < 0.35
    assert finger_openness(OPEN) > 0.85
    for hand in (FIST, V, SCROLL, RELAXED):
        assert finger_openness(hand) is None


def test_scroll_does_not_steal_a_pinch_even_with_other_fingers_straight():
    points = list(OPEN.landmarks)
    points[4] = Point(points[8].x + 0.01, points[8].y)
    hand = replace(OPEN, landmarks=tuple(points))
    scroll = HeldScroll(Recorder())
    assert not scroll.update(hand, 0).blocks_mouse


def test_sideways_pinch_uses_palm_length_when_width_is_foreshortened():
    points = list(RELAXED.landmarks)
    points[5], points[17] = Point(0.46, 0.6), Point(0.47, 0.6)
    points[4] = Point(points[8].x + 0.04, points[8].y)
    hand = replace(RELAXED, landmarks=tuple(points))
    assert pinch_distance(hand) < 0.32


def test_depth_separates_crossed_fingers_but_tolerates_contact_depth_noise():
    points = list(RELAXED.landmarks)
    points[4] = Point(points[8].x + 0.01, points[8].y)
    world = [Point(p.x * 0.25, p.y * 0.25) for p in points]
    world[4] = replace(world[4], z=0.15)
    hand = replace(RELAXED, landmarks=tuple(points), world_landmarks=tuple(world))
    assert pinch_distance(hand) > 0.65
    world[4] = replace(world[4], z=0.025)
    assert pinch_distance(replace(hand, world_landmarks=tuple(world))) < 0.32


def test_palm_rotation_tracks_wrist_turn_without_thumb_movement():
    original = palm_angles(OPEN)
    turned = palm_angles(pose_hand((5, 9, 13, 17), rotate=0.30))
    assert abs(turned[0] - original[0]) > 0.25
    points = list(OPEN.landmarks)
    points[4] = points[8]
    assert palm_angles(replace(OPEN, landmarks=tuple(points))) == original


@pytest.mark.parametrize("executable,profile", [
    ("blender.exe", "blender"), ("SLDWORKS.exe", "solidworks"),
    ("SketchUp.exe", "sketchup"), ("Fusion360.exe", "fusion"),
    ("Inventor.exe", "inventor"), ("FreeCAD.exe", "freecad"),
    ("Rhino.exe", "rhino"), ("maya.exe", "maya"),
    ("3dsmax.exe", "3dsmax"), ("acad.exe", "autocad"), ("roamer.exe", "navisworks"),
])
def test_native_profiles_are_selected_by_executable(executable, profile):
    assert detect_profile("C:\\Apps\\" + executable, "document") == PROFILES[profile]
    assert detect_profile("notepad.exe", executable) is None


def test_browser_profiles_and_manual_override():
    assert detect_profile("chrome.exe", "Part Studio - Onshape") == PROFILES["onshape"]
    assert detect_profile("msedge.exe", "SketchUp") == PROFILES["sketchup"]
    assert detect_profile("chrome.exe", "Other tab") is None
    assert detect_profile("other.exe", "Other", "fusion") == PROFILES["fusion"]


@pytest.mark.parametrize("executable", ["Breadboard.exe", "electron.exe", "chrome.exe", "msedge.exe"])
def test_breadboard_requires_the_live_canvas_hint(executable):
    assert detect_profile(executable, "Breadboard CAD | My part") == PROFILES["breadboard"]
    assert detect_profile(executable, "Private — Breadboard CAD | My part") == PROFILES["breadboard"]
    for title in ("Breadboard", "Terminal — breadboard", "Parametric CAD artifact", "My part"):
        assert detect_profile(executable, title) is None
    assert detect_profile("notepad.exe", "Breadboard CAD | My part") is None


def arm(nav):
    assert nav.update(RELAXED, 0.84, CONTEXT).blocks_mouse
    assert nav.active


def test_navigation_turns_the_hand_and_pinch_gap_zooms_without_clicks():
    recorder = Recorder()
    nav = Navigation(recorder)
    arm(nav)
    nav.update(OPEN, 0.9, CONTEXT)
    for i in range(1, 12):
        rotated = pose_hand((5, 9, 13, 17), rotate=i * 0.02)
        nav.update(rotated, 0.9 + i * 0.04, CONTEXT)
    assert recorder.rotations
    assert all(abs(dx) <= 32 and abs(dy) <= 32 for _, dx, dy in recorder.rotations)
    # Closing/opening only the thumb gap leaves the palm orientation unchanged.
    points = list(rotated.landmarks)
    points[4] = Point(points[8].x + 0.01, points[8].y)
    closed = replace(rotated, landmarks=tuple(points))
    before = len(recorder.rotations)
    for i in range(12, 32):
        nav.update(closed, 0.9 + i * 0.04, CONTEXT)
    assert sum(recorder.wheel) < 0
    recorder.wheel.clear()
    for i in range(32, 55):
        nav.update(rotated, 0.9 + i * 0.04, CONTEXT)
    assert sum(recorder.wheel) > 0
    assert len(recorder.rotations) == before


def test_automatic_entry_needs_no_pose_and_three_fingers_do_not_toggle_it():
    recorder = Recorder()
    nav = Navigation(recorder)
    arm(nav)
    assert not recorder.rotations and not recorder.wheel
    for i in range(22, 65):
        nav.update(SCROLL, i * 0.04, CONTEXT)
    assert nav.active
    changed = replace(CONTEXT, window=101, executable="notepad.exe")
    assert nav.update(OPEN, 2.65, changed).blocks_mouse
    assert not nav.active
    assert recorder.releases > 0
    assert not nav.update(OPEN, 2.69, changed).blocks_mouse


def test_switching_supported_apps_resets_the_baseline_and_selects_new_bindings():
    recorder = Recorder()
    nav = Navigation(recorder)
    arm(nav)
    changed = replace(CONTEXT, window=101, executable="Fusion360.exe")
    rotated = pose_hand((5, 9, 13, 17), rotate=0.6)
    nav.update(rotated, 0.88, changed)
    assert nav.active and nav.profile == PROFILES["fusion"] and nav.window == 101
    assert not recorder.rotations and not recorder.wheel


def test_leaving_and_reentering_the_target_releases_and_rebases_automatically():
    recorder = Recorder()
    nav = Navigation(recorder)
    arm(nav)
    recorder.allowed = False
    assert nav.update(OPEN, 0.88, CONTEXT).blocks_mouse
    assert not nav.active
    assert not nav.update(OPEN, 0.92, CONTEXT).blocks_mouse
    recorder.allowed = True
    nav.update(pose_hand((5, 9, 13, 17), rotate=0.6), 0.96, CONTEXT)
    assert nav.active and not recorder.rotations and not recorder.wheel


def test_leaving_breadboards_canvas_restores_normal_controls_in_the_same_window():
    recorder = Recorder()
    nav = Navigation(recorder)
    canvas = replace(CONTEXT, executable="Breadboard.exe", title="Breadboard CAD | Part")
    chat = replace(canvas, title="Part")
    assert nav.update(RELAXED, 0.0, canvas).blocks_mouse
    assert nav.active and nav.profile == PROFILES["breadboard"]
    assert nav.update(RELAXED, 0.04, chat).blocks_mouse
    assert not nav.active
    assert not nav.update(RELAXED, 0.08, chat).blocks_mouse
    assert nav.update(RELAXED, 0.12, canvas).blocks_mouse
    assert nav.active and not recorder.rotations and not recorder.wheel


def test_navigation_missing_hand_releases_and_reacquires_without_moving():
    recorder = Recorder()
    nav = Navigation(recorder)
    arm(nav)
    nav.update(OPEN, 0.9, CONTEXT)
    nav.update(None, 0.94, CONTEXT)
    before = len(recorder.rotations)
    nav.update(pose_hand((5, 9, 13, 17), rotate=0.6), 0.98, CONTEXT)
    assert nav.active and len(recorder.rotations) == before


@pytest.mark.parametrize("context,allowed", [
    (replace(CONTEXT, executable="notepad.exe"), True),
    (replace(CONTEXT, dialog=True), True), (CONTEXT, False),
])
def test_navigation_will_not_arm_in_unknown_apps_dialogs_or_outside_target(context, allowed):
    recorder = Recorder()
    recorder.allowed = allowed
    nav = Navigation(recorder)
    for i in range(30):
        assert not nav.update(SCROLL, i * 0.04, context).blocks_mouse
    assert not nav.active and not recorder.rotations and not recorder.wheel


@pytest.mark.parametrize("name", list(PROFILES))
def test_native_orbit_uses_profile_and_releases_all_buttons_and_keys(request, name):
    controller, state = request.getfixturevalue("native")
    profile = PROFILES[name]
    controller.orbit(profile, 100, CONTEXT.bounds, 15, 8)
    assert state.cursor == (-945, 548)
    downs = [controller.BUTTON_FLAGS[b][0] for b in profile.buttons]
    ups = [controller.BUTTON_FLAGS[b][1] for b in profile.buttons[::-1]]
    assert [flags for flags, _ in state.events] == downs
    controller.end_navigation()
    assert [flags for flags, _ in state.events] == downs + ups
    assert [key for key, up, _ in state.keys if not up] == list(profile.keys)
    assert [key for key, up, _ in state.keys if up] == list(profile.keys[::-1])
    assert all(marker != controller.VOICE_MARKER for _, _, marker in state.keys)


def test_navigation_watchdog_and_focus_switch_release_held_inputs(request):
    controller, state = request.getfixturevalue("native")
    controller._clock = lambda: 1.0
    controller.orbit(PROFILES["fusion"], 100, CONTEXT.bounds, 15, 8)
    controller._clock = lambda: 1.5
    controller.expire_navigation()
    assert not controller._nav_keys and not controller._nav_buttons
    controller.orbit(PROFILES["freecad"], 100, CONTEXT.bounds, 15, 8)
    controller.user32.GetForegroundWindow.return_value = 200
    controller.expire_navigation()
    assert not controller._nav_buttons
    before = list(state.events)
    controller.orbit(PROFILES["fusion"], 100, CONTEXT.bounds, 15, 8)
    assert state.events == before


def test_navigation_clamps_to_window_and_external_monitor_and_releases_after_disconnect(request):
    controller, state = request.getfixturevalue("native")
    controller.orbit(PROFILES["blender"], 100, CONTEXT.bounds, 10000, -10000)
    assert controller.monitor.contains(*state.cursor)
    assert -1908 <= state.cursor[0] < -12 and 50 <= state.cursor[1] < 1068
    controller.displays.ensure_current.side_effect = RuntimeError("disconnected")
    controller.release_all()
    assert not controller._nav_buttons
