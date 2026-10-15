// MousKey Remap — BepInEx 5 plugin. Remaps legacy Input.GetKey*/GetAxis for keyboard keys.
// remap.txt next to the DLL: "Physical=Logical" (KeyCode names). The game asks for Logical;
// the player presses Physical. Logical keys that are remapped away are blocked.
using System;
using System.Collections.Generic;
using System.IO;
using BepInEx;
using HarmonyLib;
using UnityEngine;

namespace MousKey
{
    [BepInPlugin("com.mouskey.remap", "MousKeyRemap", "1.0.0")]
    public class RemapPlugin : BaseUnityPlugin
    {
        internal static Dictionary<KeyCode, List<KeyCode>> LogicalToPhysical = new Dictionary<KeyCode, List<KeyCode>>();
        internal static HashSet<KeyCode> Involved = new HashSet<KeyCode>();
        [ThreadStatic] internal static bool Busy;
        internal static BepInEx.Logging.ManualLogSource Log;

        void Awake()
        {
            Log = Logger;
            var path = Path.Combine(Path.GetDirectoryName(Info.Location), "remap.txt");
            var map = new Dictionary<KeyCode, KeyCode>();
            foreach (var raw in File.Exists(path) ? File.ReadAllLines(path) : new string[0])
            {
                var line = raw.Trim();
                if (line.Length == 0 || line.StartsWith("#")) continue;
                var parts = line.Split('=');
                if (parts.Length != 2) continue;
                try { map[(KeyCode)Enum.Parse(typeof(KeyCode), parts[0].Trim(), true)] = (KeyCode)Enum.Parse(typeof(KeyCode), parts[1].Trim(), true); }
                catch { Logger.LogWarning("bad line: " + line); }
            }
            var targets = new HashSet<KeyCode>(map.Values);
            // every key that appears anywhere
            var all = new HashSet<KeyCode>(map.Keys); all.UnionWith(targets);
            foreach (var p in all)
            {
                KeyCode logical;
                if (map.TryGetValue(p, out logical)) { }           // physical p now means logical
                else if (targets.Contains(p)) continue;              // p was remapped away: blocked
                else logical = p;
                if (!LogicalToPhysical.ContainsKey(logical)) LogicalToPhysical[logical] = new List<KeyCode>();
                LogicalToPhysical[logical].Add(p);
            }
            foreach (var k in targets) if (!LogicalToPhysical.ContainsKey(k)) LogicalToPhysical[k] = new List<KeyCode>();
            Involved = all;
            new Harmony("com.mouskey.remap").PatchAll(typeof(RemapPlugin).Assembly);
            foreach (var kv in map) Logger.LogInfo($"[MousKeyRemap] {kv.Key} -> acts as {kv.Value}");
            Logger.LogInfo($"[MousKeyRemap] loaded {map.Count} mappings");
        }

        internal static bool Query(KeyCode logical, Func<KeyCode, bool> orig)
        {
            List<KeyCode> phys;
            if (!LogicalToPhysical.TryGetValue(logical, out phys)) return orig(logical);
            foreach (var p in phys) if (orig(p)) return true;
            return false;
        }
    }

    [HarmonyPatch(typeof(Input), nameof(Input.GetKey), new[] { typeof(KeyCode) })]
    static class PGetKey
    {
        static bool Prefix(KeyCode key, ref bool __result)
        {
            if (RemapPlugin.Busy || !RemapPlugin.Involved.Contains(key)) return true;
            RemapPlugin.Busy = true;
            try { __result = RemapPlugin.Query(key, k => Input.GetKey(k)); } finally { RemapPlugin.Busy = false; }
            return false;
        }
    }

    [HarmonyPatch(typeof(Input), nameof(Input.GetKeyDown), new[] { typeof(KeyCode) })]
    static class PGetKeyDown
    {
        static bool Prefix(KeyCode key, ref bool __result)
        {
            if (RemapPlugin.Busy || !RemapPlugin.Involved.Contains(key)) return true;
            RemapPlugin.Busy = true;
            try { __result = RemapPlugin.Query(key, k => Input.GetKeyDown(k)); } finally { RemapPlugin.Busy = false; }
            return false;
        }
    }

    [HarmonyPatch(typeof(Input), nameof(Input.GetKeyUp), new[] { typeof(KeyCode) })]
    static class PGetKeyUp
    {
        static bool Prefix(KeyCode key, ref bool __result)
        {
            if (RemapPlugin.Busy || !RemapPlugin.Involved.Contains(key)) return true;
            RemapPlugin.Busy = true;
            try { __result = RemapPlugin.Query(key, k => Input.GetKeyUp(k)); } finally { RemapPlugin.Busy = false; }
            return false;
        }
    }

    /// Standard keyboard axes rebuilt from (remapped) keys + arrows, with InputManager-like smoothing.
    static class AxisSim
    {
        static readonly Dictionary<string, float> Smoothed = new Dictionary<string, float>();
        static readonly Dictionary<string, int> LastFrame = new Dictionary<string, int>();
        internal static bool Raw(string axis, out float v)
        {
            v = 0;
            KeyCode pos, neg, pa, na;
            if (axis == "Horizontal") { pos = KeyCode.D; neg = KeyCode.A; pa = KeyCode.RightArrow; na = KeyCode.LeftArrow; }
            else if (axis == "Vertical") { pos = KeyCode.W; neg = KeyCode.S; pa = KeyCode.UpArrow; na = KeyCode.DownArrow; }
            else return false;
            bool p = Input.GetKey(pos) || Input.GetKey(pa);   // GetKey(pos) goes through the remap patch
            bool n = Input.GetKey(neg) || Input.GetKey(na);
            v = (p ? 1f : 0f) - (n ? 1f : 0f);
            return true;
        }
        internal static float Smooth(string axis, float target)
        {
            float cur; Smoothed.TryGetValue(axis, out cur);
            int last; LastFrame.TryGetValue(axis, out last);
            if (last != Time.frameCount)
            {
                float dt = Time.unscaledDeltaTime;
                if (target != 0 && Math.Sign(target) != Math.Sign(cur)) cur = 0; // snap like InputManager
                cur = Mathf.MoveTowards(cur, target, 3f * dt);
                Smoothed[axis] = cur; LastFrame[axis] = Time.frameCount;
            }
            return cur;
        }
    }

    [HarmonyPatch(typeof(Input), nameof(Input.GetAxis), new[] { typeof(string) })]
    static class PGetAxis
    {
        static void Postfix(string axisName, ref float __result)
        {
            float raw;
            if (!AxisSim.Raw(axisName, out raw)) return;
            __result = AxisSim.Smooth(axisName, raw);
        }
    }

    [HarmonyPatch(typeof(Input), nameof(Input.GetAxisRaw), new[] { typeof(string) })]
    static class PGetAxisRaw
    {
        static void Postfix(string axisName, ref float __result)
        {
            float raw;
            if (AxisSim.Raw(axisName, out raw)) __result = raw;
        }
    }
}
