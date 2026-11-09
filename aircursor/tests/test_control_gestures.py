import math

import pytest

from aircursor.control_gestures import ControlGestures
from aircursor.gestures import ScrollDetector
from aircursor.models import DetectedHand, Point
from aircursor.poses import HandPose, classify_pose


def pose_hand(extended=(5, 9), *, rotate=0.0, mirror=False, scale=1.0):
    points = [Point(0.5, 0.9)] * 21
    points[1:5] = [Point(0.4, 0.8), Point(0.35, 0.73),
                   Point(0.38, 0.67), Point(0.41, 0.65)]
    for mcp, x in zip((5, 9, 13, 17), (0.35, 0.46, 0.57, 0.66), strict=True):
        ys = (0.60, 0.44, 0.34, 0.27) if mcp in extended else (0.60, 0.49, 0.57, 0.65)
        points[mcp:mcp + 4] = [Point(x, y) for y in ys]
    transformed = []
    for p in points:
        x, y = (p.x - 0.5) * (-1 if mirror else 1), p.y - 0.5
        transformed.append(Point(0.5 + scale * (x * math.cos(rotate) - y * math.sin(rotate)),
                                 0.5 + scale * (x * math.sin(rotate) + y * math.cos(rotate))))
    return DetectedHand(tuple(transformed), "Left" if mirror else "Right", 0.99)


V = pose_hand()
FIST = pose_hand(())
OPEN = pose_hand((5, 9, 13, 17))
SCROLL = pose_hand((5, 9, 13))


class VoiceRecorder:
    def __init__(self):
        self.events = []
        self.held = False

    def voice_down(self):
        if not self.held:
            self.events.append("down")
            self.held = True

    def voice_up(self):
        if self.held:
            self.events.append("up")
            self.held = False


@pytest.mark.parametrize("angle", [0, math.pi / 2, -math.pi / 3, math.pi])
@pytest.mark.parametrize("mirror", [False, True])
@pytest.mark.parametrize("extended,expected", [
    ((5, 9), HandPose.V_SIGN), ((), HandPose.FIST),
    ((5, 9, 13), HandPose.SCROLL), ((5, 9, 13, 17), HandPose.NEUTRAL),
])
def test_poses_work_for_either_hand_and_rotation(angle, mirror, extended, expected):
    assert classify_pose(pose_hand(extended, rotate=angle, mirror=mirror, scale=0.6)) is expected


def test_v_and_scroll_are_separate_and_thumbs_up_is_not_a_fist():
    scroll = ScrollDetector()
    for _ in range(20):
        assert scroll.update(V) == 0
        assert not scroll.active
    for _ in range(5):
        scroll.update(SCROLL)
    assert scroll.active
    points = list(FIST.landmarks)
    points[4] = Point(0.3, 0.15)
    assert classify_pose(DetectedHand(tuple(points), "Right", 0.99)) is HandPose.NEUTRAL


def test_pinch_does_not_activate_voice():
    points = list(V.landmarks)
    points[4] = Point(points[8].x + 0.01, points[8].y)
    assert classify_pose(DetectedHand(tuple(points), "Right", 0.99)) is HandPose.NEUTRAL


def test_v_holds_once_and_releases_after_short_flicker_tolerance():
    native = VoiceRecorder()
    controls = ControlGestures(native)
    for now in (0, 0.10, 0.21, 0.25, 0.30):
        assert controls.update(V, now).blocks_mouse
    assert native.events == ["down"]
    assert controls.update(None, 0.38).blocks_mouse
    assert controls.update(V, 0.41).blocks_mouse
    assert native.events == ["down"]
    assert controls.update(OPEN, 0.50).blocks_mouse
    assert not controls.update(OPEN, 0.57).blocks_mouse
    assert native.events == ["down", "up"]


def test_brief_v_does_not_press_keys():
    native = VoiceRecorder()
    controls = ControlGestures(native)
    controls.update(V, 0)
    controls.update(V, 0.1)
    controls.update(OPEN, 0.15)
    assert native.events == []


def test_v_does_nothing_while_paused_and_pause_releases_immediately():
    native = VoiceRecorder()
    controls = ControlGestures(native, paused=True)
    for i in range(25):
        assert controls.update(V, i * 0.04).blocks_mouse
    assert native.events == []
    controls.toggle_pause()
    for i in range(25, 35):
        controls.update(V, i * 0.04)
    assert native.events == ["down"]
    controls.toggle_pause()
    assert native.events == ["down", "up"]


def test_fist_toggles_once_until_a_visible_open_hand_rearms_it():
    controls = ControlGestures(VoiceRecorder(), paused=True)
    for i in range(100):
        assert controls.update(FIST, i * 0.04).blocks_mouse
    assert not controls.paused
    # Losing tracking must not rearm a fist still held when it reappears.
    for i in range(100, 115):
        controls.update(None, i * 0.04)
    for i in range(115, 145):
        controls.update(FIST, i * 0.04)
    assert not controls.paused
    for i in range(145, 155):
        controls.update(OPEN, i * 0.04)
    for i in range(155, 190):
        controls.update(FIST, i * 0.04)
    assert controls.paused


@pytest.mark.parametrize("fps", [15, 30, 60])
def test_start_requires_three_full_seconds_at_any_frame_rate(fps):
    native = VoiceRecorder()
    controls = ControlGestures(native, paused=True)
    for frame in range(3 * fps):
        assert controls.update(FIST, frame / fps).blocks_mouse
        assert controls.paused
    assert controls.update(FIST, 3.0).blocks_mouse
    assert not controls.paused
    # Starting never activates voice or repeated toggles while still holding.
    for frame in range(1, 5 * fps):
        controls.update(FIST, 3.0 + frame / fps)
        assert not controls.paused
    assert native.events == []


@pytest.mark.parametrize("interruption", [OPEN, None, "camera_stall"])
def test_interrupted_start_needs_a_new_three_second_hold(interruption):
    controls = ControlGestures(VoiceRecorder(), paused=True)
    for frame in range(30):
        controls.update(FIST, frame / 10)
    if interruption != "camera_stall":
        controls.update(interruption, 3.0)
    for frame in range(30):
        controls.update(FIST, 4.0 + frame / 10)
        assert controls.paused
    controls.update(FIST, 7.0)
    assert not controls.paused


def test_all_launch_defaults_start_paused():
    from aircursor.app import build_parser
    from aircursor.config import AirCursorConfig

    assert AirCursorConfig().start_paused
    assert build_parser().parse_args([]).start_paused


def test_brief_fist_freezes_mouse_but_does_not_toggle():
    controls = ControlGestures(VoiceRecorder())
    for i in range(10):
        assert controls.update(FIST, i * 0.04).blocks_mouse
    controls.update(OPEN, 0.45)
    assert not controls.paused


def test_fist_ends_voice_before_waiting_for_pause_confirmation():
    native = VoiceRecorder()
    controls = ControlGestures(native)
    for now in (0, 0.1, 0.21):
        controls.update(V, now)
    assert controls.update(FIST, 0.25).blocks_mouse
    assert native.events == ["down", "up"]
    assert not controls.paused


def test_camera_gap_requires_a_fresh_v_confirmation():
    native = VoiceRecorder()
    controls = ControlGestures(native)
    for now in (0, 0.1, 0.21):
        controls.update(V, now)
    controls.update(V, 1.0)
    assert native.events == ["down", "up"]
    controls.update(V, 1.1)
    controls.update(V, 1.22)
    assert native.events == ["down", "up", "down"]
    controls.release_voice()
    assert native.events[-1] == "up"


def test_enabled_paused_voice_releases_on_loss_stall_and_fist_without_enabling_pointer():
    native = VoiceRecorder()
    controls = ControlGestures(native, paused=True, paused_voice_poses=(HandPose.V_SIGN,))
    for now in (0, 0.1, 0.21):
        assert controls.update(V, now).blocks_mouse
        assert controls.paused
    assert native.events == ["down"]
    assert controls.update(None, 0.4).blocks_mouse
    assert native.events == ["down", "up"]
    for now in (0.5, 0.6, 0.72):
        controls.update(V, now)
    controls.update(V, 1.2)  # A stalled stream cannot extend the previous hold.
    assert native.events == ["down", "up", "down", "up"]
    for now in (1.3, 1.41):
        controls.update(V, now)
    controls.update(FIST, 1.45)
    assert native.events[-2:] == ["down", "up"]
    assert controls.paused
    for i in range(1, 30):
        controls.update(FIST, 1.45 + i * 0.1)
        assert controls.paused
    controls.update(FIST, 4.46)
    assert not controls.paused
