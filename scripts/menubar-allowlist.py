#!/usr/bin/env python3
"""Show, or repair, Control Center allow-list entries for a bundle id.

macOS 26 keeps the "Allow in the Menu Bar" state in a private plist. An entry
for a *different* app (often the terminal that launched ours) can list our
bundle id in its menuItemLocations, and our own entry can stay isAllowed=False
even after the System Settings toggle is switched on. Either hides the icon.
See steipete/CodexBar#1440 and #1945.

Needs Full Disk Access for the terminal running it.

Usage:
  scripts/menubar-allowlist.py [bundle-id]            read only (default local.ctxmeter.bar)
  scripts/menubar-allowlist.py --repair [bundle-id]   back up, then set our entry allowed
                                                      and drop our id from other entries
"""
import os
import plistlib
import shutil
import subprocess
import sys
import time

PLIST = os.path.expanduser(
    "~/Library/Group Containers/group.com.apple.controlcenter/"
    "Library/Preferences/group.com.apple.controlcenter.plist"
)
KEY = "trackedApplications"


def bundle_of(location):
    return (location or {}).get("bundle", {}).get("_0")


def load():
    try:
        with open(PLIST, "rb") as handle:
            outer = plistlib.load(handle)
    except PermissionError:
        sys.exit("permission denied: grant Full Disk Access to this terminal, then rerun")
    blob = outer.get(KEY)
    if blob is None:
        sys.exit(f"no {KEY} key")
    entries = plistlib.loads(blob) if isinstance(blob, bytes) else blob
    return outer, blob, entries


def is_record(item):
    return isinstance(item, dict) and "isAllowed" in item


def report(entries, target):
    found = False
    for record in filter(is_record, entries):
        owner = bundle_of(record.get("location"))
        claimed = [bundle_of(loc) for loc in record.get("menuItemLocations", [])]
        if owner == target or target in claimed:
            found = True
            role = "own entry" if owner == target else "FOREIGN entry claiming it"
            print(f"{role}: owner={owner} isAllowed={record['isAllowed']} menuItemLocations={claimed}")
    if not found:
        print(f"no entry mentions {target}")


def repaired(record, target):
    """A new record: ours becomes allowed, others stop claiming our id (or its test variants)."""
    if not is_record(record):
        return record
    if bundle_of(record.get("location")) == target:
        return {**record, "isAllowed": True}
    kept = [loc for loc in record.get("menuItemLocations", [])
            if not (bundle_of(loc) or "").startswith(target)]
    return {**record, "menuItemLocations": kept}


def repair(outer, blob, entries, target):
    backup = f"{PLIST}.bak-{time.strftime('%Y%m%d-%H%M%S')}"
    shutil.copy2(PLIST, backup)
    new_entries = [repaired(item, target) for item in entries]
    new_blob = (plistlib.dumps(new_entries, fmt=plistlib.FMT_BINARY)
                if isinstance(blob, bytes) else new_entries)
    with open(PLIST, "wb") as handle:
        plistlib.dump({**outer, KEY: new_blob}, handle, fmt=plistlib.FMT_BINARY)
    # cfprefsd caches the old value and Control Center re-reads through it, so
    # both restart (macOS relaunches them at once). The app's own remembered
    # "hidden" flag goes too, or it would be restored.
    subprocess.run(["killall", "cfprefsd"], check=False)
    subprocess.run(["killall", "-9", "ControlCenter"], check=False)
    subprocess.run(["defaults", "delete", target, "NSStatusItem VisibleCC Item-0"],
                   check=False, stderr=subprocess.DEVNULL)
    print(f"backup: {backup}")
    print(f"rollback: cp '{backup}' '{PLIST}' && killall cfprefsd && killall -9 ControlCenter")


def main():
    args = sys.argv[1:]
    do_repair = "--repair" in args
    rest = [a for a in args if a != "--repair"]
    target = rest[0] if rest else "local.ctxmeter.bar"
    outer, blob, entries = load()
    if do_repair:
        repair(outer, blob, entries, target)
        _, _, entries = load()
    report(entries, target)


if __name__ == "__main__":
    main()
