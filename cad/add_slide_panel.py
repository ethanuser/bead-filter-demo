"""Adds a slide-in clear panel with a snap detent to the filter body.

Run: python3 add_slide_panel.py
Appends features to the end of Part Studio 1 (skips any that already exist by name):
  - a front frame on the body with a groove the panel slides down into from the top,
  - a 2 mm lip in front of the groove whose window matches the cavity,
  - a domed bump on the body face near the top that clicks into a hole in the panel,
  - the panel itself (1/8 in / 3 mm acrylic) with a finger tab above the body.
"""
import onshape_client as c
from build_filter_demo import (P, Builder, Sketch, created_face, extrude, feature, p_bool, p_enum,
                               p_qty, p_query, variable)

FRONT_FACE_PLANE = "FeGbPZiv9gIX6zK_1"  # "Plane: front face", y = -#bodyD

VARIABLES = [
    ("slideClr", "LENGTH", "0.5 mm", "Groove play over panel thickness (acrylic 3 mm +/- 0.3)"),
    ("grooveW", "LENGTH", "#panelT + #slideClr", "Panel groove width (front-to-back)"),
    ("lipT", "LENGTH", "2 mm", "Front lip thickness"),
    ("engage", "LENGTH", "3.5 mm", "Lip overlap onto the panel edges"),
    ("edgeClr", "LENGTH", "0.4 mm", "Side clearance per panel edge"),
    ("tabH", "LENGTH", "8 mm", "Panel finger tab above the body"),
    ("nubD", "LENGTH", "3 mm", "Snap detent bump diameter"),
    ("nubInt", "LENGTH", "0.4 mm", "Detent interference with the panel"),
    ("holeD", "LENGTH", "3.4 mm", "Detent hole in the panel"),
]
P.update(slideClr=0.5, lipT=2, engage=3.5, edgeClr=0.4, tabH=8, nubD=3, nubInt=0.4, holeD=3.4)


def scoped_remove(name, sketch_fid, depth, body_feature_id):
    """Extrude-remove that only cuts the body created by `body_feature_id`."""
    return feature("extrude", name, [
        p_enum("bodyType", "ExtendedToolBodyType", "SOLID"),
        p_enum("operationType", "NewBodyOperationType", "REMOVE"),
        p_query("entities", [{"btType": "BTMIndividualSketchRegionQuery-140", "featureId": sketch_fid}]),
        p_enum("endBound", "BoundingType", "BLIND"),
        p_qty("depth", depth),
        p_bool("oppositeDirection", False),
        p_bool("defaultScope", False),
        p_query("booleanScope", [{"btType": "BTMIndividualQuery-138",
                                  "queryString": f'query=qCreatedBy(makeId("{body_feature_id}"), EntityType.BODY);'}]),
    ])


def main():
    b = Builder()
    for v in VARIABLES:
        b.add(variable(*v))

    plane = created_face(FRONT_FACE_PLANE)
    w2, h, wall, cw2 = P["bodyW"] / 2, P["bodyH"], P["wall"], P["cavW"] / 2
    eng = P["engage"]

    # Front frame: a full-outline slab on the old front face.
    sk = Sketch("Sketch: front frame", plane)
    sk.rect("f", -w2, 0, w2, h, "#bodyW", "#bodyH", "#bodyW / 2", None)
    b.add(extrude("Front frame", b.sketch(sk), "ADD", "#grooveW + #lipT"))

    # Groove: open at the top so the panel slides straight down.
    sk = Sketch("Sketch: panel groove", plane)
    sk.rect("g", -cw2 - eng, wall - eng, cw2 + eng, h + 1,
            "#cavW + 2 * #engage", "#bodyH + 1 mm - #wall + #engage",
            "#cavW / 2 + #engage", "#wall - #engage")
    b.add(extrude("Panel groove", b.sketch(sk), "REMOVE", "#grooveW"))

    # Window through the lip, same footprint as the cavity.
    sk = Sketch("Sketch: front window", plane)
    sk.rect("w", -cw2, wall, cw2, wall + P["cavH"], "#cavW", "#cavH", "#cavW / 2", "#wall")
    b.add(extrude("Front window", b.sketch(sk), "REMOVE", "#grooveW + #lipT"))

    # Snap detent: a bump on the body face, centred on the top wall, rounded into a dome.
    z_nub = h - wall / 2
    sk = Sketch("Sketch: detent nub", plane)
    sk.circle("n", 0, z_nub, "#nubD", "#bodyH - #wall / 2")
    nub = b.add(extrude("Detent nub", b.sketch(sk), "ADD", "#slideClr + #nubInt"))
    b.add(feature("fillet", "Detent nub dome", [
        p_query("entities", [{"btType": "BTMIndividualQuery-138",
                              "queryString": f'query=qCapEntity(makeId("{nub}"), CapType.END, EntityType.EDGE);'}]),
        p_qty("radius", "#slideClr + #nubInt - 0.1 mm"),
    ]))

    # The panel: sits on the groove floor, 0.4 mm side play, finger tab above the body.
    sk = Sketch("Sketch: slide panel", plane)
    sk.rect("p", -cw2 - eng + P["edgeClr"], wall - eng, cw2 + eng - P["edgeClr"], h + P["tabH"],
            "#cavW + 2 * (#engage - #edgeClr)", "#bodyH + #tabH - #wall + #engage",
            "#cavW / 2 + #engage - #edgeClr", "#wall - #engage")
    panel = b.add(extrude("Slide panel", b.sketch(sk), "NEW", "#panelT"))

    sk = Sketch("Sketch: panel detent hole", plane)
    sk.circle("h", 0, z_nub, "#holeD", "#bodyH - #wall / 2")
    b.add(scoped_remove("Panel detent hole", b.sketch(sk), "#panelT", panel))
    print(f"API calls this run: {c.CALLS}")


if __name__ == "__main__":
    main()
