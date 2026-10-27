#!/usr/bin/env python3
"""Package only the binary, trust store, documentation and redistribution notices."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import tempfile
try:
    import tomllib
except ModuleNotFoundError:
    tomllib = None
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def get_version():
    cargo_text = (ROOT / 'Cargo.toml').read_text()
    if tomllib:
        return tomllib.loads(cargo_text)['package']['version']
    match = re.search(r'(?m)^version\s*=\s*"([^"]+)"', cargo_text)
    if match:
        return match.group(1)
    raise SystemExit("Cannot determine version from Cargo.toml")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--target', required=True)
    parser.add_argument('--flavor', choices=['full', 'cli'], default='full')
    args = parser.parse_args()
    version = get_version()
    windows = 'windows' in args.target
    binary = 'gdirect.exe' if windows else 'gdirect'
    executable = ROOT / 'target' / args.target / 'release' / binary
    if not executable.exists():
        raise SystemExit(f'Missing binary: {executable}')
    prefix = 'gdirect-cli' if args.flavor == 'cli' else 'gdirect'
    name = f'{prefix}-{version}-{args.target}'
    dist = ROOT / 'dist'
    dist.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory() as temporary:
        folder = Path(temporary) / name
        folder.mkdir()
        shutil.copy2(executable, folder / binary)
        for document in ['README.md', 'README.zh-CN.md', 'LICENSE']:
            shutil.copy2(ROOT / document, folder / document)
        if (ROOT / 'docs/configuration').is_dir():
            shutil.copytree(ROOT / 'docs/configuration', folder / 'docs/configuration')
        # No CA bundle ships: Google endpoints are verified against Google's
        # own GTS roots, which are embedded in the binary.
        for url, destination in [
            ('https://raw.githubusercontent.com/openssl/openssl/openssl-3.0.0/LICENSE.txt', 'OPENSSL-LICENSE.txt'),
        ]:
            with urllib.request.urlopen(url, timeout=60) as response:
                (folder / destination).write_bytes(response.read())
        info = {'version': version, 'target': args.target, 'aria2': '1.37.0',
                'commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
                'rustc': subprocess.check_output(['rustc', '--version'], text=True).strip()}
        (folder / 'BUILD-INFO.json').write_text(json.dumps(info, indent=2) + '\n')
        if windows:
            archive = dist / f'{name}.zip'
            with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as output:
                for file in sorted(folder.rglob('*')):
                    if file.is_file():
                        output.write(file, f'{name}/{file.relative_to(folder).as_posix()}')
        else:
            archive = dist / f'{name}.tar.gz'
            with tarfile.open(archive, 'w:gz') as output:
                output.add(folder, arcname=name)
        # Smoke test the packaged layout if host can execute target binary.
        if 'android' not in args.target:
            output = subprocess.check_output([str(folder / binary), '--version'], text=True).strip()
            assert output == f'gdirect {version}', output
    if hasattr(hashlib, 'file_digest'):
        digest = hashlib.file_digest(archive.open('rb'), 'sha256').hexdigest()
    else:
        h = hashlib.sha256()
        with archive.open('rb') as f:
            while chunk := f.read(65536):
                h.update(chunk)
        digest = h.hexdigest()
    (dist / f'{archive.name}.sha256').write_text(f'{digest}  {archive.name}\n', newline='\n')
    print(archive.name)


if __name__ == '__main__':
    main()
