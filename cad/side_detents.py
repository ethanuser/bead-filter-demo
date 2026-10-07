"""Replaces the single centre detent with two side detents on the hidden panel margins.

Run: python3 side_detents.py   (after add_slide_panel.py)

The centre bump rubbed a line down the middle of the window every time the panel slid in.
Now each side of the panel has a U-notch in its edge, and a domed bump on the body rim
behind the lip clicks into it. The bumps only ever touch the 3 mm margin strip hidden
behind the lip. To let the panel ride over them, a slit next to each side lip turns that
strip into a beam held at both ends that bends slightly (~5 N per side at 0.4 mm).
"""
import onshape_client as c
from add_slide_panel import FRONT_FACE_PLANE, scoped_remove
from build_filter_demo import (P, Builder, Sketch, created_face, extrude, feature, p_query,
                               p_qty, variable)

OLD_FEATURES = ["Panel detent hole", "Sketch: panel detent hole", "Detent nub dome",
                "Detent nub", "Sketch: detent nub"]  # dependents first

NEW_VARIABLES = [
    ("detentZ", "LENGTH", "60 mm", "Height of the side detents above the body bottom"),
    ("flexL", "LENGTH", "50 mm", "Length of the flexing lip beam beside each detent"),
    ("slitW", "LENGTH", "0.6 mm", "Width of the slit that frees each flexing lip beam"),
]
CHANGED_VARIABLES = [
    ("nubD", "LENGTH", "2 mm", "Side detent bump diameter"),
    ("holeD", "LENGTH", "2.4 mm", "Width of the U-notch in each panel edge"),
]
P.update(nubD=2, holeD=2.4, detentZ=60, flexL=50, slitW=0.6, engage=3.5, edgeClr=0.4)

BODY_FEATURE = "FXLxR4dWf7k2ig7_0"  # "Body" extrude: creates the filter body
X_DETENT = "#cavW / 2 + (#engage - #edgeClr) / 2"  # centre of the hidden margin strip


def scoped_op(name, sketch_fid, op, depth, body_feature_id):
    """Extrude add/remove that only affects the body created by `body_feature_id`."""
    f = scoped_remove(name, sketch_fid, depth, body_feature_id)
    for prm in f["parameters"]:
        if prm["parameterId"] == "operationType":
            prm["value"] = op
    return f


def circle_at(sk, eid, cx, cy, d, d_expr, x_expr, y_expr):
    sk.entities.append({
        "btType": "BTMSketchCurve-4", "entityId": eid, "centerId": f"{eid}.center",
        "isConstruction": False,
        "geometry": {"btType": "BTCurveGeometryCircle-115", "radius": d / 2 * 0.001,
                     "xCenter": cx * 0.001, "yCenter": cy * 0.001, "xDir": 1.0, "yDir": 0.0,
                     "clockwise": False},
    })
    sk.con("DIAMETER", {"btType": "BTMParameterString-149", "parameterId": "localFirst", "value": eid},
           p_qty("length", d_expr))
    sk.dist_origin(f"{eid}.center", "HORIZONTAL", x_expr)
    sk.dist_origin(f"{eid}.center", "VERTICAL", y_expr)


def main():
    b = Builder()

    for name in OLD_FEATURES:
        if name in b.ids:
            c.request("DELETE", c.ps(f"/features/featureid/{b.ids.pop(name)}"))
            print(f"  - {name}")

    for v in CHANGED_VARIABLES:
        f = variable(*v)
        fid = b.ids[f["name"]]
        f["featureId"] = fid
        c.post(c.ps(f"/features/featureid/{fid}"), {"feature": f})
        print(f"  ~ {f['name']:<28} = {v[2]}")
    for v in NEW_VARIABLES:
        b.add(variable(*v))

    plane = created_face(FRONT_FACE_PLANE)
    cw2, z = P["cavW"] / 2, P["detentZ"]
    xd = cw2 + (P["engage"] - P["edgeClr"]) / 2       # 26.55
    x_groove = cw2 + P["engage"]                       # 28.5, outer edge of the groove
    x_out = P["bodyW"] / 2 - 1                         # 30, past the panel edge
    z0 = z - P["flexL"] / 2

    # Slits beside each side lip so the lip strip over the panel margin can flex.
    sk = Sketch("Sketch: flex slits", plane)
    sk.rect("r", x_groove, z0, x_groove + P["slitW"], z0 + P["flexL"],
            "#slitW", "#flexL", "#cavW / 2 + #engage", "#detentZ - #flexL / 2")
    sk.rect("l", -x_groove - P["slitW"], z0, -x_groove, z0 + P["flexL"],
            "#slitW", "#flexL", "#cavW / 2 + #engage + #slitW", "#detentZ - #flexL / 2")
    b.add(scoped_remove("Flex slits", b.sketch(sk), "#grooveW + #lipT", BODY_FEATURE))

    # Domed bumps on the body rim, one behind each flexing lip beam.
    sk = Sketch("Sketch: side detents", plane)
    circle_at(sk, "r", xd, z, P["nubD"], "#nubD", X_DETENT, "#detentZ")
    circle_at(sk, "l", -xd, z, P["nubD"], "#nubD", X_DETENT, "#detentZ")
    # Scoped to the body: the bumps overlap the panel until its notches are cut, and an
    # unscoped add would fuse body and panel into one part.
    nubs = b.add(scoped_op("Side detents", b.sketch(sk), "ADD", "#slideClr + #nubInt", BODY_FEATURE))
    b.add(feature("fillet", "Side detent domes", [
        p_query("entities", [{"btType": "BTMIndividualQuery-138",
                              "queryString": f'query=qCapEntity(makeId("{nubs}"), CapType.END, EntityType.EDGE);'}]),
        p_qty("radius", "min(#slideClr + #nubInt, #nubD / 2) - 0.1 mm"),
    ]))

    # U-notches in the panel's side edges that the bumps click into.
    panel = b.ids["Slide panel"]
    sk = Sketch("Sketch: panel edge notches", plane)
    for side, s in (("r", 1), ("l", -1)):
        lo, hi = sorted((s * xd, s * x_out))
        sk.rect(f"{side}n", lo, z - P["holeD"] / 2, hi, z + P["holeD"] / 2,
                f"#bodyW / 2 - 1 mm - ({X_DETENT})", "#holeD",
                X_DETENT if s > 0 else "#bodyW / 2 - 1 mm", "#detentZ - #holeD / 2")
        circle_at(sk, f"{side}c", s * xd, z, P["holeD"], "#holeD", X_DETENT, "#detentZ")
    b.add(scoped_remove("Panel edge notches", b.sketch(sk), "#panelT", panel))
    print(f"API calls this run: {c.CALLS}")


if __name__ == "__main__":
    main()
