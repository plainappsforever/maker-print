#!/usr/bin/env python3
"""Checker for the blind A1 oracle: python3 -I blind_a1_check.py cases.json results.json
results.json is written by the thin Jest adapter (engine outputs only; no expectations computed in TypeScript)."""
import json, math, sys, collections
sys.path.insert(0, __file__.rsplit('/', 1)[0] if '/' in __file__ else '.')
import blind_a1_oracle as O

CODE = {"outside": {"outside"}, "degenerate": {"degenerate"}, "angle": {"degenerate", "concave"},
        "selfIntersecting": {"selfIntersecting"}, "mirrored": {"mirrored"}, "concave": {"concave"},
        "tooSmall": {"tooSmall"}}

def pct(xs, p):
    if not xs: return None
    s = sorted(xs); k = min(len(s) - 1, max(0, int(math.ceil(p / 100 * len(s))) - 1)); return s[k]

def dist_line(xs):
    if not xs: return "n=0"
    return f"n={len(xs)} p50={pct(xs,50)*100:.3f}% p90={pct(xs,90)*100:.3f}% max={max(xs)*100:.3f}%"

def main(cp, rp):
    C = json.load(open(cp)); R = json.load(open(rp))
    rep = collections.OrderedDict(); fails = collections.defaultdict(list)
    agree = collections.defaultdict(lambda: [0, 0])          # name -> [agree, asserted]
    def tally(name, ok, cid, detail=""):
        agree[name][1] += 1
        if ok: agree[name][0] += 1
        else: fails[name].append(f"{cid} {detail}")
    err = collections.defaultdict(list); err_by_noise = collections.defaultdict(list)
    rep_err = collections.defaultdict(list); outdev = []; capviol = []
    src_match = collections.Counter()
    for c in C["photos"]:
        res = R["photos"].get(c["id"], {})
        for mode, m in c["modes"].items():
            r = res.get(mode)
            if r is None: tally(f"{mode}.ran", False, c["id"], "missing"); continue
            if r.get("error"): tally(f"{mode}.ran", False, c["id"], r["error"]); continue
            tally(f"{mode}.ran", True, c["id"])
            e = m["expect"]; warns = set(r.get("warnings") or [])
            if mode in ("a", "aw", "d"):
                ok = r.get("sizeKnown") and abs(r["wMm"] - e["wMm"]) < 1e-6 and abs(r["hMm"] - e["hMm"]) < 1e-6
                tally(f"{mode}.size", ok, c["id"], f"got {r.get('wMm')}x{r.get('hMm')} want {e['wMm']:.3f}x{e['hMm']:.3f}")
                tally(f"{mode}.noEstimatedFlag", "aspectEstimated" not in warns, c["id"], str(sorted(warns)))
            if mode in ("a", "aw") and e.get("aspectMismatch") is not None:
                tally(f"{mode}.aspectMismatch", ("aspectMismatch" in warns) == e["aspectMismatch"], c["id"],
                      f"want {e['aspectMismatch']} got {sorted(warns)} noise {c['noise']} exif {m['useExif']}")
            if mode in ("b", "c"):
                if not r.get("sizeKnown"): tally(f"{mode}.sizeKnown", False, c["id"]); continue
                tally(f"{mode}.sizeKnown", True, c["id"])
                typedW = "wMm" in m["typed"]
                got = r["hMm"] if typedW else r["wMm"]
                truth = e["truthHMm"] if typedW else e["truthWMm"]
                tw = r["wMm"] if typedW else r["hMm"]; tt = m["typed"]["wMm"] if typedW else m["typed"]["hMm"]
                tally(f"{mode}.typedSideKept", abs(tw - tt) < 1e-6, c["id"], f"{tw} vs {tt}")
                rel = abs(got / truth - 1)
                err[mode].append(rel); err_by_noise[(mode, c["noise"])].append(rel)
                if mode == "c": err_by_noise[("c-" + c["replica"]["noExifSource"], c["noise"])].append(rel)
                rv = e["replicaHMm"] if typedW else e["replicaWMm"]
                if rv is not None:
                    rep_err[mode].append(abs(got / rv - 1))
                    tally(f"{mode}.replica<=1e-6", abs(got / rv - 1) <= 1e-6, c["id"], f"got {got:.4f} replica {rv:.4f}")
                elif mode == "c":
                    q = e["replicaQuad"]; a = e["replicaAssumed"]
                    qv = (q[1] if typedW else q[0]) if q else None; av = (a[1] if typedW else a[0]) if a else None
                    if qv and abs(got / qv - 1) <= 1e-6: src_match["quad"] += 1
                    elif av and abs(got / av - 1) <= 1e-6: src_match["assumed"] += 1
                    else: src_match["neither"] += 1
                tally(f"{mode}.aspectEstimated", "aspectEstimated" in warns, c["id"], str(sorted(warns)))
                if e.get("aspectWeak") is not None:
                    tally(f"{mode}.aspectWeak", ("aspectWeak" in warns) == e["aspectWeak"], c["id"],
                          f"want {e['aspectWeak']} got {sorted(warns)} sens {c['replica']['gateSensitivity']}")
            if mode == "e":
                tally("e.noSize", not r.get("sizeKnown"), c["id"], str(r))
            if e.get("lowDetail") is not None and mode in ("a", "b", "c", "d"):
                tally("lowDetail", ("lowDetail" in warns) == e["lowDetail"], c["id"],
                      f"{mode} want {e['lowDetail']} ppi {c['replica']['farEdgePpiTruth']:.1f} got {sorted(warns)}")
            if r.get("sizeKnown") and r.get("outW"):
                ow, oh, capped = O.out_pixels(c["cornersOrdered"], r["wMm"], r["hMm"])
                dev = max(abs(r["outW"] / ow - 1), abs(r["outH"] / oh - 1)); outdev.append(dev)
                tally("outPixels<=1%", dev <= 0.01, c["id"] + mode, f"got {r['outW']}x{r['outH']} want {ow:.1f}x{oh:.1f}")
            if r.get("outW"):
                if r["outW"] * r["outH"] > O.CAP_SI: capviol.append(f"{c['id']}{mode} {r['outW']}x{r['outH']}")
    # verdicts
    for v in C["verdicts"]:
        r = R["verdicts"].get(v["id"]) or {}
        d = r.get("direct")
        acc = set()
        for k in v["violated"]: acc |= CODE.get(k, set())
        name = "verdict.boundary" if v["boundary"] else "verdict"
        if v["expectOk"]:
            tally(name, d == "ok", v["id"], f"{v['group']} want ok got {d} {v['note']}")
        elif "nonFinite" in v["violated"]:
            tally(name, d not in (None, "ok") and not str(d).startswith("threw"), v["id"], f"{v['group']} want reject got {d}")
        else:
            okd = d in acc if len(v["violated"]) == 1 else (d not in (None, "ok") and not str(d).startswith("threw"))
            tally(name, okd, v["id"], f"{v['group']} want {sorted(acc)} got {d} {v['note']}")
            tally(name + ".rejected", d not in (None, "ok") and not str(d).startswith("threw"), v["id"], f"{v['group']} got {d}")
        if v["group"] in ("bowtie", "ccw"):
            tally("verdict.sortedAccepts", r.get("sorted") == "ok", v["id"], f"{v['group']} sorted got {r.get('sorted')}")
    # homographies
    herr = collections.defaultdict(list)
    for h in C["homographies"]:
        r = R["homographies"].get(h["id"]) or {}
        if r.get("error"): tally("homography.ran", False, h["id"], r["error"]); continue
        tally("homography.ran", True, h["id"])
        pts = [p["out"] for p in h["points"]] + [[0, 0], [h["outW"], 0], [h["outW"], h["outH"]], [0, h["outH"]]]
        e = max(math.hypot(a[0] - b[0], a[1] - b[1]) for a, b in zip(pts, r["points"] + r["corners"]))
        herr["hard" if h["hard"] else "normal"].append(e)
        tally("homography<=0.01px", e <= 0.01, h["id"], f"{e:.3g}px")
    # exif
    for x in C["exif"]:
        got = R["exif"].get(x["id"])
        if x["expect"] == "implausible":
            rep.setdefault("exifImplausible", []).append(f"{x['id']} value {x['value']} -> {got}")
        else:
            tally("exif", got == x["expect"], x["id"], f"{x['byteOrder']} {x['type']} v{x['value']} has35 {x['has35']} want {x['expect']} got {got}")
    # caps
    cdev = []
    for m in C["caps"]:
        r = R["caps"].get(m["id"]) or {}
        if not r.get("outW"): tally("cap.ran", False, m["id"], str(r)); continue
        tally("cap<=16e6", r["outW"] * r["outH"] <= O.CAP_SI, m["id"], f"{r['outW']}x{r['outH']}={r['outW']*r['outH']}")
        e = m["expect"]; d = max(abs(r["outW"] / e["outW"] - 1), abs(r["outH"] / e["outH"] - 1)); cdev.append(d)
        tally("cap.dims<=1%", d <= 0.01, m["id"], f"got {r['outW']}x{r['outH']} want {e['outW']:.1f}x{e['outH']:.1f}")
        if e["capped"]:
            tally("cap.used>=99%", r["outW"] * r["outH"] >= 0.99 * O.CAP_SI, m["id"], f"{r['outW']*r['outH']}")
    # print
    print("== agreement (agree / asserted)")
    for k in sorted(agree): print(f"  {k:28s} {agree[k][0]:5d} / {agree[k][1]:5d}")
    print("== estimated-side error vs camera truth")
    for mode in ("b", "c"): print(f"  {mode}: {dist_line(err[mode])}")
    for k in sorted(err_by_noise): print(f"  {k[0]:10s} noise {k[1]}px: {dist_line(err_by_noise[k])}")
    print("== engine vs replica (same corners)")
    for mode in rep_err: print(f"  {mode}: {dist_line(rep_err[mode])}")
    print("  c ambiguous-gate source match:", dict(src_match))
    print("== output pixels vs D91 reading:", dist_line(outdev), "| over 16e6:", len(capviol), capviol[:5])
    print("== homography error px:", {k: (len(v), max(v)) for k, v in herr.items()})
    print("== cap dims deviation:", dist_line(cdev))
    for k, v in rep.items(): print("==", k, v)
    print("== disagreements (first 8 per check)")
    for k in sorted(fails):
        print(f"  [{k}] {len(fails[k])}")
        for f in fails[k][:8]: print("     ", f)

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
