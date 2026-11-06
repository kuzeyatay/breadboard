using System;

internal static class ScopeTests
{
    private static void Check(bool value, string message) { if (!value) throw new Exception(message); }
    private static void Main()
    {
        foreach (bool inside in new[] { false, true })
        foreach (bool shiftFirst in new[] { false, true })
        foreach (bool releaseShiftFirst in new[] { false, true })
        {
            int testStarts = 0, existingStarts = 0, finishes = 0;
            var scope = new DictationWindowScope();
            var test = new DictationChord { Start = delegate { testStarts++; }, Finish = delegate { finishes++; }, Cancel = delegate {}, Replay = delegate {} };
            var existing = new DictationChord { Start = delegate { existingStarts++; }, Finish = delegate {}, Cancel = delegate {}, Replay = delegate {} };
            Action<int, bool, int, bool> key = delegate(int code, bool up, int now, bool owns) {
                var input = new DictationChord.Key(code, up);
                if (!scope.Handle(owns, code, up, false) || !test.Handle(input, now, false)) existing.Handle(input, now, false);
            };
            key(shiftFirst ? 0xA0 : 0xA2, false, 0, inside);
            key(shiftFirst ? 0xA2 : 0xA0, false, 20, inside);
            test.Tick(200); existing.Tick(200);
            Check(testStarts == (inside ? 1 : 0), "test starts only in its own window");
            Check(existingStarts == (inside ? 0 : 1), "existing hook cannot also start in test window");
            // Matching releases still reach the test if focus moves away.
            key(releaseShiftFirst ? 0xA0 : 0xA2, true, 210, false);
            key(releaseShiftFirst ? 0xA2 : 0xA0, true, 220, false);
            Check(finishes == (inside ? 1 : 0), "release outside window still ends test recording");
            Check(!scope.Handle(false, 0x41, false, false), "outside keys pass through after release");
        }
        {
            var scope = new DictationWindowScope();
            Check(!scope.Handle(true, 0xA2, false, true), "injected keys never change test scope");
            Check(!scope.Handle(false, 0xA0, false, false), "injected key cannot retain scope");
            Check(scope.Handle(true, 0x41, false, false), "track ordinary key inside window");
            Check(scope.Handle(false, 0x41, true, false), "matching ordinary key release cannot leave stale chord state");
            Check(!scope.Handle(false, 0xA0, false, false), "scope is returned after ordinary key release");
        }
        Console.WriteLine("Isolated dictation window scope checks passed.");
    }
}
