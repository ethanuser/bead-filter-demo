"""Builds the two-stage bead filtration demo as native Onshape features.

Run:  python3 build_filter_demo.py [stage]
Features that already exist (matched by name) are skipped, so re-running is safe.

Coordinate frame (world):
  X = device width, Z = device height (flow runs -Z), Y = depth.
  The back face sits on the Front plane; the open front + clear panel face the viewer.
"""
import sys

import onshape_client as c

MM = 0.001
ORIGIN = "IB"
FRONT, TOP, RIGHT = "JCC", "JDC", "JEC"

# ---------------------------------------------------------------- parameters
# (name, type, expression, description). Python mirrors are used only to
# place initial sketch geometry; the sketch dimensions use the #variables.
VARIABLES = [
    ("wall", "LENGTH", "6 mm", "Rim / outer wall width (tape land)"),
    ("back", "LENGTH", "3 mm", "Back wall thickness"),
    ("cavD", "LENGTH", "10 mm", "Cavity depth (front-to-back)"),
    ("cavW", "LENGTH", "50 mm", "Cavity width"),
    ("hTop", "LENGTH", "30 mm", "Top chamber height (6 mm beads)"),
    ("hMid", "LENGTH", "25 mm", "Middle chamber height (3 mm beads)"),
    ("hBot", "LENGTH", "20 mm", "Bottom reservoir height"),
    ("gridT", "LENGTH", "3 mm", "Grid thickness in flow direction"),
    ("coarseGap", "LENGTH", "4.5 mm", "Coarse grid slot width (< 6 mm beads)"),
    ("coarseN", "NUMBER", "8", "Coarse grid slot count"),
    ("fineGap", "LENGTH", "2 mm", "Fine grid slot width (< 3 mm beads)"),
    ("fineN", "NUMBER", "14", "Fine grid slot count"),
    ("nipOD", "LENGTH", "10 mm", "Nipple outer diameter (3/8 in ID tubing)"),
    ("nipID", "LENGTH", "7 mm", "Nipple bore (> 6 mm beads)"),
    ("nipL", "LENGTH", "15 mm", "Nipple length"),
    ("panelT", "LENGTH", "3 mm", "Clear panel thickness"),
    ("bodyW", "LENGTH", "#cavW + 2 * #wall", "Overall width"),
    ("cavH", "LENGTH", "#hBot + #hMid + #hTop + 2 * #gridT", "Cavity height"),
    ("bodyH", "LENGTH", "#cavH + 2 * #wall", "Overall height"),
    ("bodyD", "LENGTH", "#back + #cavD", "Overall depth (without panel)"),
]
P = dict(wall=6, back=3, cavD=10, cavW=50, hTop=30, hMid=25, hBot=20, gridT=3,
         coarseGap=4.5, fineGap=2, nipOD=10, nipID=7, nipL=15, panelT=3)
P["cavH"] = P["hBot"] + P["hMid"] + P["hTop"] + 2 * P["gridT"]
P["bodyW"] = P["cavW"] + 2 * P["wall"]
P["bodyH"] = P["cavH"] + 2 * P["wall"]
P["bodyD"] = P["back"] + P["cavD"]


# ---------------------------------------------------------------- JSON helpers
def q(*det_ids):
    return [{"btType": "BTMIndividualQuery-138", "deterministicIds": list(det_ids)}]


def created_face(fid):
    """Query for the face/plane created by a feature (e.g. an offset plane)."""
    return [{"btType": "BTMIndividualQuery-138",
             "queryString": f'query=qCreatedBy(makeId("{fid}"), EntityType.FACE);'}]


def p_query(pid, queries):
    return {"btType": "BTMParameterQueryList-148", "parameterId": pid, "queries": queries}


def p_enum(pid, enum, value):
    return {"btType": "BTMParameterEnum-145", "parameterId": pid, "enumName": enum, "value": value}


def p_qty(pid, expr):
    return {"btType": "BTMParameterQuantity-147", "parameterId": pid, "expression": expr}


def p_bool(pid, value):
    return {"btType": "BTMParameterBoolean-144", "parameterId": pid, "value": value}


def p_str(pid, value):
    return {"btType": "BTMParameterString-149", "parameterId": pid, "value": value}


def feature(ftype, name, params):
    return {"btType": "BTMFeature-134", "featureType": ftype, "name": name, "parameters": params}


def variable(name, vtype, expr, desc):
    value_param = {"LENGTH": "lengthValue", "NUMBER": "numberValue"}[vtype]
    return feature("assignVariable", f"Variable #{name}", [
        p_enum("variableType", "VariableType", vtype),
        p_str("name", name),
        p_qty(value_param, expr),
        p_str("description", desc),
    ])


# ---------------------------------------------------------------- sketch helpers
class Sketch:
    def __init__(self, name, plane_query):
        self.name = name
        self.plane = plane_query
        self.entities = []
        self.constraints = []
        self._n = 0

    def _cid(self):
        self._n += 1
        return f"c{self._n}"

    def con(self, ctype, *params):
        self.constraints.append({"btType": "BTMSketchConstraint-2", "constraintType": ctype,
                                 "entityId": self._cid(), "parameters": list(params)})

    def line(self, eid, x0, y0, x1, y1):
        dx, dy = x1 - x0, y1 - y0
        length = (dx * dx + dy * dy) ** 0.5
        self.entities.append({
            "btType": "BTMSketchCurveSegment-155", "entityId": eid,
            "startPointId": f"{eid}.start", "endPointId": f"{eid}.end",
            "startParam": 0.0, "endParam": length * MM, "isConstruction": False,
            "geometry": {"btType": "BTCurveGeometryLine-117", "pntX": x0 * MM, "pntY": y0 * MM,
                         "dirX": dx / length, "dirY": dy / length},
        })

    def rect(self, pre, x0, y0, x1, y1, w_expr, h_expr, left_expr, bottom_expr):
        """Axis-aligned rectangle, fully dimensioned relative to the origin.

        left_expr / bottom_expr: horizontal / vertical distance from origin to the
        left / bottom edge (None = origin lies on that edge).
        """
        b, r, t, l = (f"{pre}.bottom", f"{pre}.right", f"{pre}.top", f"{pre}.left")
        self.line(b, x0, y0, x1, y0)
        self.line(r, x1, y0, x1, y1)
        self.line(t, x1, y1, x0, y1)
        self.line(l, x0, y1, x0, y0)
        for a, z in ((b, r), (r, t), (t, l), (l, b)):
            self.con("COINCIDENT", p_str("localFirst", f"{a}.end"), p_str("localSecond", f"{z}.start"))
        self.con("HORIZONTAL", p_str("localFirst", b))
        self.con("HORIZONTAL", p_str("localFirst", t))
        self.con("VERTICAL", p_str("localFirst", l))
        self.con("VERTICAL", p_str("localFirst", r))
        self.length(b, w_expr)
        self.length(l, h_expr)
        self.dist_origin(l, "HORIZONTAL", left_expr)
        if bottom_expr is None:
            self.con("COINCIDENT", p_str("localFirst", b), p_query("externalSecond", q(ORIGIN)))
        else:
            self.dist_origin(b, "VERTICAL", bottom_expr)

    def circle(self, eid, cx, cy, d_expr, cy_expr):
        """Circle centred on X=0 (Right plane), offset cy_expr from origin vertically."""
        self.entities.append({
            "btType": "BTMSketchCurve-4", "entityId": eid, "centerId": f"{eid}.center",
            "isConstruction": False,
            "geometry": {"btType": "BTCurveGeometryCircle-115", "radius": 0.5 * P_d(d_expr) * MM,
                         "xCenter": cx * MM, "yCenter": cy * MM, "xDir": 1.0, "yDir": 0.0,
                         "clockwise": False},
        })
        self.con("DIAMETER", p_str("localFirst", eid), p_qty("length", d_expr))
        self.con("COINCIDENT", p_str("localFirst", f"{eid}.center"), p_query("externalSecond", q(RIGHT)))
        self.dist_origin(f"{eid}.center", "VERTICAL", cy_expr)

    def length(self, eid, expr):
        self.con("LENGTH", p_str("localFirst", eid), p_qty("length", expr))

    def dist_origin(self, eid, direction, expr):
        self.con("DISTANCE", p_str("localFirst", eid), p_query("externalSecond", q(ORIGIN)),
                 p_enum("direction", "DimensionDirection", direction), p_qty("length", expr))

    def json(self):
        return {"btType": "BTMSketch-151", "featureType": "newSketch", "name": self.name,
                "parameters": [p_query("sketchPlane", self.plane)],
                "entities": self.entities, "constraints": self.constraints}


def P_d(expr):
    """Initial diameter for circle geometry from a '#var' expression."""
    return P[expr.lstrip("#")]


def extrude(name, sketch_fid, op, depth, opposite=False, symmetric=False):
    params = [
        p_enum("bodyType", "ExtendedToolBodyType", "SOLID"),
        p_enum("operationType", "NewBodyOperationType", op),
        p_query("entities", [{"btType": "BTMIndividualSketchRegionQuery-140", "featureId": sketch_fid}]),
        p_enum("endBound", "BoundingType", "BLIND"),
        p_qty("depth", depth),
        p_bool("oppositeDirection", opposite),
        p_bool("symmetric", symmetric),
    ]
    if op != "NEW":
        params.append(p_bool("defaultScope", True))
    return feature("extrude", name, params)


def offset_plane(name, ref, offset, opposite=False):
    return feature("cPlane", name, [
        p_query("entities", q(ref)),
        p_enum("cplaneType", "CPlaneType", "OFFSET"),
        p_qty("offset", offset),
        p_bool("oppositeDirection", opposite),
    ])


def linear_pattern(name, feature_ids, count, spacing):
    return feature("linearPattern", name, [
        p_enum("patternType", "PatternType", "FEATURE"),
        {"btType": "BTMParameterFeatureList-1749", "parameterId": "instanceFunction",
         "featureIds": feature_ids},
        p_query("directionOne", q(RIGHT)),
        p_qty("distance", spacing),
        p_qty("instanceCount", count),
        p_bool("oppositeDirection", False),
        p_bool("fullFeaturePattern", True),  # "Reapply features" (required for sketch-based cuts)
    ])


# ---------------------------------------------------------------- build driver
class Builder:
    def __init__(self):
        feats = c.get(c.ps("/features"))["features"]
        feats = [f.get("message", f) for f in feats]
        self.ids = {f["name"]: f["featureId"] for f in feats}

    def add(self, fjson):
        name = fjson["name"]
        if name in self.ids:
            return self.ids[name]
        res = c.post(c.ps("/features"), {"feature": fjson})
        fid = res["feature"]["featureId"]
        status = res.get("featureState", {}).get("featureStatus")
        self.ids[name] = fid
        print(f"  + {name:<28} {fid}  {status}")
        if status not in ("OK", None):
            raise SystemExit(f"Stopping: '{name}' status {status}")
        return fid

    def sketch(self, sk):
        return self.add(sk.json())


def stage_body(b):
    for v in VARIABLES:
        b.add(variable(*v))

    w2, h = P["bodyW"] / 2, P["bodyH"]
    sk = Sketch("Sketch: body outline", q(FRONT))
    sk.rect("o", -w2, 0, w2, h, "#bodyW", "#bodyH", "#bodyW / 2", None)
    outline = b.sketch(sk)
    b.add(extrude("Body", outline, "NEW", "#bodyD"))


def stage_cavity(b, outline):
    cw2, wall = P["cavW"] / 2, P["wall"]
    sk = Sketch("Sketch: cavity", q(FRONT))
    sk.rect("cav", -cw2, wall, cw2, wall + P["cavH"], "#cavW", "#cavH", "#cavW / 2", "#wall")
    b.add(extrude("Cavity cut", b.sketch(sk), "REMOVE", "#bodyD"))

    # Grid shelves (overlap 1 mm into the side walls so they fuse cleanly)
    z_fine = wall + P["hBot"]
    z_coarse = z_fine + P["gridT"] + P["hMid"]
    sk = Sketch("Sketch: grid shelves", q(FRONT))
    sk.rect("fine", -cw2 - 1, z_fine, cw2 + 1, z_fine + P["gridT"],
            "#cavW + 2 mm", "#gridT", "#cavW / 2 + 1 mm", "#wall + #hBot")
    sk.rect("coarse", -cw2 - 1, z_coarse, cw2 + 1, z_coarse + P["gridT"],
            "#cavW + 2 mm", "#gridT", "#cavW / 2 + 1 mm", "#wall + #hBot + #gridT + #hMid")
    b.add(extrude("Grid shelves", b.sketch(sk), "ADD", "#bodyD"))

    # One slot per grid at the left wall, then patterned across (+X).
    for tag, gap, n, z, zexpr in (
        ("fine", "fineGap", "fineN", z_fine, "#wall + #hBot - 1 mm"),
        ("coarse", "coarseGap", "coarseN", z_coarse, "#wall + #hBot + #gridT + #hMid - 1 mm"),
    ):
        sk = Sketch(f"Sketch: {tag} slot", q(FRONT))
        sk.rect("s", -cw2, z - 1, -cw2 + P[gap], z + P["gridT"] + 1,
                f"#{gap}", "#gridT + 2 mm", "#cavW / 2", zexpr)
        cut = b.add(extrude(f"{tag.capitalize()} slot cut", b.sketch(sk), "REMOVE", "#bodyD"))
        b.add(linear_pattern(f"{tag.capitalize()} slot pattern", [cut], f"#{n}",
                             f"(#cavW - #{gap}) / (#{n} - 1)"))

    # Back wall last: re-closes the back after the through-cuts above.
    b.add(extrude("Back wall", outline, "ADD", "#back"))


def stage_nipples(b, ysign):
    yc = ysign * (P["back"] + P["cavD"] / 2)
    yexpr = "#back + #cavD / 2"
    top = b.add(offset_plane("Plane: top face", TOP, "#bodyH"))
    for tag, plane, up in (("Inlet", created_face(top), False),
                           ("Outlet", q(TOP), True)):
        sk = Sketch(f"Sketch: {tag.lower()} nipple", plane)
        sk.circle("n", 0, yc, "#nipOD", yexpr)
        b.add(extrude(f"{tag} nipple", b.sketch(sk), "ADD", "#nipL", opposite=up))
        sk = Sketch(f"Sketch: {tag.lower()} bore", plane)
        sk.circle("b", 0, yc, "#nipID", yexpr)
        b.add(extrude(f"{tag} bore", b.sketch(sk), "REMOVE", "2 * (#nipL + 1 mm)", symmetric=True))


def stage_panel(b, outline_dir_opposite):
    w2, h = P["bodyW"] / 2, P["bodyH"]
    pl = b.add(offset_plane("Plane: front face", FRONT, "#bodyD", opposite=outline_dir_opposite))
    sk = Sketch("Sketch: clear panel", created_face(pl))
    sk.rect("p", -w2, 0, w2, h, "#bodyW", "#bodyH", "#bodyW / 2", None)
    b.add(extrude("Clear panel", b.sketch(sk), "NEW", "#panelT", opposite=outline_dir_opposite))


if __name__ == "__main__":
    stage = sys.argv[1] if len(sys.argv) > 1 else "body"
    b = Builder()
    if stage in ("body", "all"):
        stage_body(b)
    if stage in ("cavity", "all"):
        stage_cavity(b, b.ids["Sketch: body outline"])
    if stage in ("nipples", "all"):
        stage_nipples(b, ysign=-1)  # body extrudes toward -Y from the Front plane
    if stage in ("panel", "all"):
        stage_panel(b, outline_dir_opposite=False)
    print(f"API calls this run: {c.CALLS}")
