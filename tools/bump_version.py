#!/usr/bin/env python3
"""Bumps the app version (patch, minor or major), adds the changelog entry and regenerates app.json.

Usage: python3 tools/bump_version.py patch "Changelog text"
Prints the new version. Used by the GitHub workflow "Publish to Homey".
"""
import json
import os
import re
import subprocess
import sys

ROOT = os.path.join(os.path.dirname(__file__), '..')
APP = os.path.join(ROOT, 'com.pepane13.ariston')
BUILD = os.path.join(ROOT, 'tools', 'build_app_json.py')


def main():
    kind, text = sys.argv[1], sys.argv[2].strip()
    if kind not in ('patch', 'minor', 'major'):
        sys.exit('version must be patch, minor or major')
    if len(text) < 4:
        sys.exit('changelog text is too short')

    src = open(BUILD, encoding='utf-8').read()
    current = re.search(r"^VERSION = '(\d+)\.(\d+)\.(\d+)'", src, re.M)
    major, minor, patch = (int(x) for x in current.groups())
    if kind == 'major':
        major, minor, patch = major + 1, 0, 0
    elif kind == 'minor':
        minor, patch = minor + 1, 0
    else:
        patch += 1
    version = f'{major}.{minor}.{patch}'

    src = re.sub(r"^VERSION = '[^']*'", f"VERSION = '{version}'", src, count=1, flags=re.M)
    open(BUILD, 'w', encoding='utf-8').write(src)

    pkg_path = os.path.join(APP, 'package.json')
    pkg = json.load(open(pkg_path, encoding='utf-8'))
    pkg['version'] = version
    open(pkg_path, 'w', encoding='utf-8').write(json.dumps(pkg, indent=2) + '\n')

    lock_path = os.path.join(APP, 'package-lock.json')
    if os.path.exists(lock_path):
        lock = json.load(open(lock_path, encoding='utf-8'))
        lock['version'] = version
        if '' in lock.get('packages', {}):
            lock['packages']['']['version'] = version
        open(lock_path, 'w', encoding='utf-8').write(json.dumps(lock, indent=2) + '\n')

    log_path = os.path.join(APP, '.homeychangelog.json')
    log = json.load(open(log_path, encoding='utf-8')) if os.path.exists(log_path) else {}
    log[version] = {'en': text, 'fr': text}
    open(log_path, 'w', encoding='utf-8').write(json.dumps(log, ensure_ascii=False, indent=2) + '\n')

    subprocess.run([sys.executable, BUILD], check=True, stdout=subprocess.DEVNULL)
    print(version)


if __name__ == '__main__':
    main()
