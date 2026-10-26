#!/usr/bin/env python3
"""Regenerate src/google-ranges.txt: Google's own service prefixes.

Google publishes every address it owns (goog.json) and the subset it leases
to Google Cloud customers (cloud.json). The difference is where Google's own
front ends live, so gdirect only scans and trusts addresses inside it. The
binary embeds this snapshot and refreshes it at runtime (src/ranges.rs).
"""
import ipaddress
import json
import sys
import urllib.request
from datetime import date
from pathlib import Path

BASE = 'https://www.gstatic.com/ipranges/'


def prefixes(name):
    with urllib.request.urlopen(BASE + name, timeout=30) as response:
        data = json.load(response)
    return [ipaddress.ip_network(p.get('ipv4Prefix') or p.get('ipv6Prefix')) for p in data['prefixes']]


def subtract(keep, drop):
    result = list(ipaddress.collapse_addresses(n for n in keep if n.version == 4)) + list(
        ipaddress.collapse_addresses(n for n in keep if n.version == 6))
    for hole in drop:
        nxt = []
        for net in result:
            if net.version != hole.version or not net.overlaps(hole):
                nxt.append(net)
            elif not hole.supernet_of(net):
                nxt.extend(net.address_exclude(hole))
        result = nxt
    v4 = ipaddress.collapse_addresses(n for n in result if n.version == 4)
    v6 = ipaddress.collapse_addresses(n for n in result if n.version == 6)
    return list(v4) + list(v6)


def main():
    out = Path(__file__).resolve().parent.parent / 'src/google-ranges.txt'
    nets = subtract(prefixes('goog.json'), prefixes('cloud.json'))
    lines = [f'# Google service prefixes (goog.json minus cloud.json), {date.today()}',
             '# Regenerate with scripts/update-ranges.py'] + [str(n) for n in nets]
    out.write_text('\n'.join(lines) + '\n')
    print(f'{out}: {len(nets)} prefixes', file=sys.stderr)


if __name__ == '__main__':
    main()
