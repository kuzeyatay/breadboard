using System.Collections.Generic;

// Test-only gate. Outside the owned window, leave the existing application's
// shortcut alone. Retain matching releases if focus leaves during a hold.
internal sealed class DictationWindowScope
{
    private readonly HashSet<int> down = new HashSet<int>();
    internal bool Handle(bool ownsForeground, int key, bool up, bool injected)
    {
        if (injected || (!ownsForeground && down.Count == 0)) return false;
        if (up) down.Remove(key); else down.Add(key);
        return true;
    }
}
