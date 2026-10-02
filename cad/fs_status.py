"""Print Onshape's error code for a feature: python3 fs_status.py <featureId>"""
import json
import sys

import onshape_client as c

fid = sys.argv[1]
s = ('function(context is Context, queries) { return getFeatureStatus(context, makeId("%s")); }' % fid)
r = c.post(c.ps("/featurescript"), {"script": s})
entries = r["result"].get("value") or []
print({e["key"]["value"]: e["value"].get("value") for e in entries})
